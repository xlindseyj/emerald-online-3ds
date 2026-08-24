#import "EO3DSCoreSession.h"

#import <CommonCrypto/CommonDigest.h>
#import <dlfcn.h>
#import <os/lock.h>

#include <sys/types.h>
#include <unistd.h>

#include <atomic>
#include <array>
#include <chrono>
#include <cstring>
#include <exception>
#include <string>
#include <unordered_map>
#include "libretro.h"

static NSString *const EO3DSCoreErrorDomain = @"com.emeraldonline3ds.mobile.core";
static EO3DSCoreSession *activeSession = nil;
static std::atomic_bool jit26ProtocolReady{false};

BOOL EO3DSHasGetTaskAllow(void) {
  using CreateTask = CFTypeRef (*)(CFAllocatorRef);
  using CopyEntitlement = CFTypeRef (*)(CFTypeRef, CFStringRef, CFErrorRef *);
  static void *security = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY | RTLD_LOCAL);
  void *symbols = security ? security : RTLD_DEFAULT;
  auto createTask = reinterpret_cast<CreateTask>(dlsym(symbols, "SecTaskCreateFromSelf"));
  auto copyEntitlement = reinterpret_cast<CopyEntitlement>(dlsym(symbols, "SecTaskCopyValueForEntitlement"));
  if (!createTask || !copyEntitlement) return NO;
  CFTypeRef task = createTask(kCFAllocatorDefault);
  if (!task) return NO;
  CFTypeRef value = copyEntitlement(task, CFSTR("get-task-allow"), nullptr);
  const BOOL allowed = value == kCFBooleanTrue;
  if (value) CFRelease(value);
  CFRelease(task);
  return allowed;
}

BOOL EO3DSIsDebuggerAttached(void) {
#if TARGET_OS_SIMULATOR
  return NO;
#else
  using CodeSigningStatus = int (*)(pid_t, unsigned int, void *, size_t);
  auto status = reinterpret_cast<CodeSigningStatus>(dlsym(RTLD_DEFAULT, "csops"));
  if (!status) return NO;
  constexpr unsigned int operation = 0;
  constexpr int debugged = 0x10000000;
  int flags = 0;
  return status(getpid(), operation, &flags, sizeof(flags)) == 0 && (flags & debugged) != 0;
#endif
}

BOOL EO3DSIsJIT26ProtocolReady(void) {
  return jit26ProtocolReady.load();
}

struct CoreAPI {
  void (*set_environment)(retro_environment_t);
  void (*set_video_refresh)(retro_video_refresh_t);
  void (*set_audio_sample)(retro_audio_sample_t);
  void (*set_audio_sample_batch)(retro_audio_sample_batch_t);
  void (*set_input_poll)(retro_input_poll_t);
  void (*set_input_state)(retro_input_state_t);
  void (*init)(void);
  void (*deinit)(void);
  bool (*load_game)(const retro_game_info *);
  void (*unload_game)(void);
  void (*run)(void);
  void (*reset)(void);
  void (*get_system_info)(retro_system_info *);
  void (*get_system_av_info)(retro_system_av_info *);
  size_t (*serialize_size)(void);
  bool (*serialize)(void *, size_t);
  bool (*unserialize)(const void *, size_t);
  bool (*jit26_begin_preparation)(void);
  int (*jit26_protocol_state)(void);
  bool (*jit26_finish_preparation)(void);
};

@interface EO3DSCoreSession () {
@public
  NSURL *_coreURL;
  NSURL *_runtimeURL;
  NSURL *_userRootURL;
  UIImageView *_imageView;
  void *_coreHandle;
  CoreAPI _api;
  dispatch_queue_t _emulationQueue;
  dispatch_queue_t _videoQueue;
  dispatch_source_t _timer;
  std::atomic_bool _running;
  std::atomic_bool _paused;
  std::atomic_bool _variablesChanged;
  std::atomic_bool _landscape;
  std::atomic_bool _videoFramePending;
  std::array<std::atomic_bool, 16> _buttons;
  std::atomic<int16_t> _touchX;
  std::atomic<int16_t> _touchY;
  std::atomic_bool _touchPressed;
  std::atomic<double> _fps;
  std::atomic<NSUInteger> _videoFramesReceived;
  std::atomic_bool _hasNonBlackVideoFrame;
  std::atomic<NSUInteger> _audioFramesReceived;
  BOOL _JITEnabled;
  BOOL _JIT26Enabled;
  std::chrono::steady_clock::time_point _fpsWindow;
  NSUInteger _fpsFrames;
  double _sampleRate;
  std::string _corePath;
  std::string _runtimePath;
  std::string _systemPath;
  std::string _savePath;
  std::unordered_map<std::string, std::string> _variables;
  NSMutableData *_softwareFramebuffer;
}
@end

static void *loadSymbol(void *handle, const char *name) {
  return dlsym(handle, name);
}

static bool environmentCallback(unsigned command, void *data) {
  EO3DSCoreSession *session = activeSession;
  if (!session) return false;
  switch (command) {
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
      *(const char **)data = session->_systemPath.c_str();
      return true;
    case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
      *(const char **)data = session->_savePath.c_str();
      return true;
    case RETRO_ENVIRONMENT_GET_CORE_ASSETS_DIRECTORY:
      *(const char **)data = session->_systemPath.c_str();
      return true;
    case RETRO_ENVIRONMENT_GET_LIBRETRO_PATH:
      *(const char **)data = session->_corePath.c_str();
      return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE: {
      retro_variable *variable = static_cast<retro_variable *>(data);
      auto value = session->_variables.find(variable->key ?: "");
      variable->value = value == session->_variables.end() ? nullptr : value->second.c_str();
      return variable->value != nullptr;
    }
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
      *(bool *)data = session->_variablesChanged.exchange(false);
      return true;
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
      return *(retro_pixel_format *)data == RETRO_PIXEL_FORMAT_XRGB8888;
    case RETRO_ENVIRONMENT_GET_CURRENT_SOFTWARE_FRAMEBUFFER: {
      retro_framebuffer *framebuffer = static_cast<retro_framebuffer *>(data);
      if (!framebuffer || framebuffer->width == 0 || framebuffer->height == 0 ||
          framebuffer->width > 2048 || framebuffer->height > 2048 ||
          framebuffer->format != RETRO_PIXEL_FORMAT_XRGB8888) return false;
      const size_t pitch = framebuffer->width * 4;
      const size_t length = pitch * framebuffer->height;
      if (!session->_softwareFramebuffer || session->_softwareFramebuffer.length != length) {
        session->_softwareFramebuffer = [NSMutableData dataWithLength:length];
      }
      framebuffer->data = session->_softwareFramebuffer.mutableBytes;
      framebuffer->pitch = pitch;
      framebuffer->access_flags = RETRO_MEMORY_ACCESS_WRITE;
      framebuffer->memory_flags = 0;
      return true;
    }
    case RETRO_ENVIRONMENT_GET_CAN_DUPE:
      if (data) *(bool *)data = true;
      return true;
    case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
    case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
    case RETRO_ENVIRONMENT_SET_CONTROLLER_INFO:
    case RETRO_ENVIRONMENT_SET_SUBSYSTEM_INFO:
    case RETRO_ENVIRONMENT_SET_MEMORY_MAPS:
    case RETRO_ENVIRONMENT_SET_SERIALIZATION_QUIRKS:
    case RETRO_ENVIRONMENT_SET_VARIABLES:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_V2:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_DISPLAY:
      return true;
    case RETRO_ENVIRONMENT_GET_CORE_OPTIONS_VERSION:
      *(unsigned *)data = 2;
      return true;
    case RETRO_ENVIRONMENT_GET_LANGUAGE:
      *(unsigned *)data = RETRO_LANGUAGE_ENGLISH;
      return true;
    case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:
      return true;
    case RETRO_ENVIRONMENT_GET_JIT_CAPABLE:
      if (data) *(bool *)data = session->_JITEnabled;
      return true;
    case RETRO_ENVIRONMENT_SET_GEOMETRY:
      return true;
    case RETRO_ENVIRONMENT_SET_MESSAGE: {
      const retro_message *message = static_cast<const retro_message *>(data);
      if (message && message->msg && session.messageHandler) {
        session.messageHandler([NSString stringWithUTF8String:message->msg]);
      }
      return true;
    }
    case RETRO_ENVIRONMENT_SET_HW_RENDER:
    case RETRO_ENVIRONMENT_SET_HW_RENDER_CONTEXT_NEGOTIATION_INTERFACE:
      return false;
    default:
      return false;
  }
}

static void videoCallback(const void *data, unsigned width, unsigned height, size_t pitch) {
  EO3DSCoreSession *session = activeSession;
  if (!session || !data || data == RETRO_HW_FRAME_BUFFER_VALID || width == 0 || height == 0) return;
  const NSUInteger frameNumber = session->_videoFramesReceived.fetch_add(1) + 1;
  if (!session->_hasNonBlackVideoFrame.load() && (frameNumber <= 5 || frameNumber % 60 == 0)) {
    const uint8_t *pixels = static_cast<const uint8_t *>(data);
    bool nonBlack = false;
    for (unsigned row = 0; row < height && !nonBlack; row++) {
      const uint8_t *line = pixels + row * pitch;
      for (unsigned column = 0; column < width; column++) {
        const size_t offset = column * 4;
        if (line[offset] || line[offset + 1] || line[offset + 2]) { nonBlack = true; break; }
      }
    }
    if (nonBlack) session->_hasNonBlackVideoFrame = true;
  }
  if (session->_videoFramePending.exchange(true)) return;
  NSMutableData *copy = [NSMutableData dataWithLength:width * height * 4];
  uint8_t *destination = static_cast<uint8_t *>(copy.mutableBytes);
  const uint8_t *source = static_cast<const uint8_t *>(data);
  if (pitch == width * 4) memcpy(destination, source, width * height * 4);
  else for (unsigned row = 0; row < height; row++) memcpy(destination + row * width * 4, source + row * pitch, width * 4);

  dispatch_async(session->_videoQueue, ^{
    @autoreleasepool {
      CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)copy);
      CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
      CGImageRef image = CGImageCreate(width, height, 8, 32, width * 4, colorSpace,
                                       kCGBitmapByteOrder32Little | kCGImageAlphaNoneSkipFirst,
                                       provider, nullptr, false, kCGRenderingIntentDefault);
      UIImage *frame = image ? [UIImage imageWithCGImage:image scale:1 orientation:UIImageOrientationUp] : nil;
      if (image) CGImageRelease(image);
      CGColorSpaceRelease(colorSpace);
      CGDataProviderRelease(provider);
      dispatch_async(dispatch_get_main_queue(), ^{
        if (session->_running.load()) session->_imageView.image = frame;
        session->_videoFramePending = false;
      });
    }
  });
}

static void audioSampleCallback(int16_t left, int16_t right) {
  int16_t samples[2] = { left, right };
  EO3DSCoreSession *session = activeSession;
  if (session.audioHandler) session.audioHandler([NSData dataWithBytes:samples length:sizeof(samples)], 1, session->_sampleRate);
}

static size_t audioBatchCallback(const int16_t *data, size_t frames) {
  EO3DSCoreSession *session = activeSession;
  if (session && data && frames && session.audioHandler) {
    session->_audioFramesReceived.fetch_add(frames);
    session.audioHandler([NSData dataWithBytes:data length:frames * 2 * sizeof(int16_t)], frames, session->_sampleRate);
  }
  return frames;
}

static void inputPollCallback(void) {}

static int16_t inputStateCallback(unsigned port, unsigned device, unsigned index, unsigned id) {
  EO3DSCoreSession *session = activeSession;
  if (!session || port != 0) return 0;
  if (device == RETRO_DEVICE_JOYPAD) {
    if (id == RETRO_DEVICE_ID_JOYPAD_MASK) {
      int16_t mask = 0;
      for (unsigned button = 0; button < session->_buttons.size(); button++) if (session->_buttons[button].load()) mask |= (1 << button);
      return mask;
    }
    return id < session->_buttons.size() && session->_buttons[id].load() ? 1 : 0;
  }
  if (device == RETRO_DEVICE_POINTER && index == 0) {
    if (id == RETRO_DEVICE_ID_POINTER_X) return session->_touchX.load();
    if (id == RETRO_DEVICE_ID_POINTER_Y) return session->_touchY.load();
    if (id == RETRO_DEVICE_ID_POINTER_PRESSED) return session->_touchPressed.load() ? 1 : 0;
  }
  return 0;
}

@implementation EO3DSCoreSession

- (instancetype)initWithCoreURL:(NSURL *)coreURL runtimeURL:(NSURL *)runtimeURL userRootURL:(NSURL *)userRootURL jitEnabled:(BOOL)jitEnabled {
  self = [super init];
  if (self) {
    _coreURL = coreURL;
    _runtimeURL = runtimeURL;
    _userRootURL = userRootURL;
    dispatch_queue_attr_t emulationAttributes = dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INTERACTIVE, 0);
    dispatch_queue_attr_t videoAttributes = dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_USER_INITIATED, 0);
    _emulationQueue = dispatch_queue_create("com.emeraldonline3ds.mobile.emulation", emulationAttributes);
    _videoQueue = dispatch_queue_create("com.emeraldonline3ds.mobile.video", videoAttributes);
    _running = false;
    _paused = false;
    _variablesChanged = false;
    _landscape = false;
    _videoFramePending = false;
    _touchPressed = false;
    _fps = 0;
    _videoFramesReceived = 0;
    _hasNonBlackVideoFrame = false;
    _audioFramesReceived = 0;
    _JITEnabled = jitEnabled;
    NSOperatingSystemVersion version = NSProcessInfo.processInfo.operatingSystemVersion;
    _JIT26Enabled = jitEnabled && version.majorVersion >= 26;
    for (auto &button : _buttons) button = false;
    _corePath = coreURL.fileSystemRepresentation;
    _runtimePath = runtimeURL.fileSystemRepresentation;
    _systemPath = userRootURL.fileSystemRepresentation;
    _savePath = userRootURL.fileSystemRepresentation;
    _variables = {
      {"citra_graphics_api", "Software"},
      {"citra_use_cpu_jit", jitEnabled ? "enabled" : "disabled"},
      // Azahar's shader JIT allocates executable regions lazily. Keep it off on
      // iOS 26 so universal.js can prepare every executable region before detach.
      {"citra_use_shader_jit", jitEnabled && !_JIT26Enabled ? "enabled" : "disabled"},
      {"citra_resolution_factor", "1"},
      {"citra_layout_option", "default"},
      {"citra_use_virtual_sd", "enabled"},
      // Azahar appends its own Azahar/sdmc tree to the frontend save root.
      // Use the documented option value; "disabled" is not a valid value and
      // silently selects Azahar's unrelated platform-default directory.
      {"citra_use_libretro_save_path", "LibRetro Default"},
      {"citra_enable_touch_touchscreen", "enabled"},
      {"citra_enable_mouse_touchscreen", "disabled"}
    };
  }
  return self;
}

- (BOOL)isRunning { return _running.load(); }
- (double)framesPerSecond { return _fps.load(); }
- (NSUInteger)videoFramesReceived { return _videoFramesReceived.load(); }
- (BOOL)hasNonBlackVideoFrame { return _hasNonBlackVideoFrame.load(); }
- (NSUInteger)audioFramesReceived { return _audioFramesReceived.load(); }
- (BOOL)isJITEnabled { return _JITEnabled; }

- (BOOL)startInImageView:(UIImageView *)imageView error:(NSError **)error {
  if (_running.load()) return YES;
  if (activeSession && activeSession != self) {
    if (error) *error = [NSError errorWithDomain:EO3DSCoreErrorDomain code:1 userInfo:@{NSLocalizedDescriptionKey: @"Another emulator session is active."}];
    return NO;
  }
  _coreHandle = dlopen(_corePath.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (!_coreHandle) {
    if (error) *error = [NSError errorWithDomain:EO3DSCoreErrorDomain code:2 userInfo:@{NSLocalizedDescriptionKey: [NSString stringWithFormat:@"Unable to load the signed Azahar core: %s", dlerror() ?: "unknown error"]}];
    return NO;
  }
#define LOAD_API(field, symbol) _api.field = reinterpret_cast<decltype(_api.field)>(loadSymbol(_coreHandle, symbol))
  LOAD_API(set_environment, "retro_set_environment");
  LOAD_API(set_video_refresh, "retro_set_video_refresh");
  LOAD_API(set_audio_sample, "retro_set_audio_sample");
  LOAD_API(set_audio_sample_batch, "retro_set_audio_sample_batch");
  LOAD_API(set_input_poll, "retro_set_input_poll");
  LOAD_API(set_input_state, "retro_set_input_state");
  LOAD_API(init, "retro_init");
  LOAD_API(deinit, "retro_deinit");
  LOAD_API(load_game, "retro_load_game");
  LOAD_API(unload_game, "retro_unload_game");
  LOAD_API(run, "retro_run");
  LOAD_API(reset, "retro_reset");
  LOAD_API(get_system_info, "retro_get_system_info");
  LOAD_API(get_system_av_info, "retro_get_system_av_info");
  LOAD_API(serialize_size, "retro_serialize_size");
  LOAD_API(serialize, "retro_serialize");
  LOAD_API(unserialize, "retro_unserialize");
#undef LOAD_API
  _api.jit26_begin_preparation = reinterpret_cast<decltype(_api.jit26_begin_preparation)>(
      loadSymbol(_coreHandle, "azahar_jit26_begin_preparation"));
  _api.jit26_protocol_state = reinterpret_cast<decltype(_api.jit26_protocol_state)>(
      loadSymbol(_coreHandle, "azahar_jit26_protocol_state"));
  _api.jit26_finish_preparation = reinterpret_cast<decltype(_api.jit26_finish_preparation)>(
      loadSymbol(_coreHandle, "azahar_jit26_finish_preparation"));
  if (!_api.set_environment || !_api.set_video_refresh || !_api.set_audio_sample ||
      !_api.set_audio_sample_batch || !_api.set_input_poll || !_api.set_input_state ||
      !_api.init || !_api.deinit || !_api.load_game || !_api.unload_game || !_api.run ||
      !_api.reset || !_api.get_system_info || !_api.get_system_av_info ||
      !_api.serialize_size || !_api.serialize || !_api.unserialize) {
    if (error) *error = [NSError errorWithDomain:EO3DSCoreErrorDomain code:3 userInfo:@{NSLocalizedDescriptionKey: @"The Azahar core is missing a required libretro symbol."}];
    dlclose(_coreHandle);
    _coreHandle = nullptr;
    return NO;
  }

  activeSession = self;
  _videoFramesReceived = 0;
  _hasNonBlackVideoFrame = false;
  _audioFramesReceived = 0;
  _imageView = imageView;
  _api.set_environment(environmentCallback);
  _api.set_video_refresh(videoCallback);
  _api.set_audio_sample(audioSampleCallback);
  _api.set_audio_sample_batch(audioBatchCallback);
  _api.set_input_poll(inputPollCallback);
  _api.set_input_state(inputStateCallback);
  _api.init();
  retro_game_info game = {};
  game.path = _runtimePath.c_str();
  const BOOL needsJIT26Preparation = _JIT26Enabled && !jit26ProtocolReady.load();
  if (needsJIT26Preparation &&
      (!_api.jit26_begin_preparation || !_api.jit26_protocol_state ||
       !_api.jit26_finish_preparation)) {
    _api.deinit();
    activeSession = nil;
    dlclose(_coreHandle);
    _coreHandle = nullptr;
    if (error) *error = [NSError errorWithDomain:EO3DSCoreErrorDomain code:8 userInfo:@{NSLocalizedDescriptionKey: @"This Azahar core does not include the iOS 26 universal JIT protocol."}];
    return NO;
  }
  if (needsJIT26Preparation && !EO3DSIsDebuggerAttached()) {
    _api.deinit();
    activeSession = nil;
    dlclose(_coreHandle);
    _coreHandle = nullptr;
    if (error) *error = [NSError errorWithDomain:EO3DSCoreErrorDomain code:9 userInfo:@{NSLocalizedDescriptionKey: @"StikDebug detached before Azahar could prepare its iOS 26 JIT cache. Enable JIT again and return directly to Emerald Online 3DS."}];
    return NO;
  }
  if (needsJIT26Preparation && !_api.jit26_begin_preparation()) {
    _api.deinit();
    activeSession = nil;
    dlclose(_coreHandle);
    _coreHandle = nullptr;
    if (error) *error = [NSError errorWithDomain:EO3DSCoreErrorDomain code:10 userInfo:@{NSLocalizedDescriptionKey: @"Azahar could not begin iOS 26 JIT preparation."}];
    return NO;
  }

  BOOL loaded = NO;
  try {
    loaded = _api.load_game(&game);
  } catch (const std::exception &) {
    loaded = NO;
  } catch (...) {
    loaded = NO;
  }
  BOOL protocolFinished = YES;
  if (needsJIT26Preparation) {
    protocolFinished = _api.jit26_finish_preparation() && _api.jit26_protocol_state() == 2;
    if (loaded && protocolFinished) jit26ProtocolReady = true;
  }
  if (!loaded || !protocolFinished) {
    _api.deinit();
    activeSession = nil;
    dlclose(_coreHandle);
    _coreHandle = nullptr;
    NSString *message = !protocolFinished
      ? @"StikDebug did not complete Azahar's iOS 26 JIT preparation and detach handshake."
      : @"Azahar rejected the bundled Emerald Online 3DS runtime.";
    if (error) *error = [NSError errorWithDomain:EO3DSCoreErrorDomain code:4 userInfo:@{NSLocalizedDescriptionKey: message}];
    return NO;
  }
  retro_system_av_info av = {};
  _api.get_system_av_info(&av);
  _sampleRate = av.timing.sample_rate > 0 ? av.timing.sample_rate : 32768.0;
  double fps = av.timing.fps > 1 ? av.timing.fps : 60.0;
  _running = true;
  _fpsWindow = std::chrono::steady_clock::now();
  _fpsFrames = 0;
  _timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, _emulationQueue);
  dispatch_source_set_timer(_timer, DISPATCH_TIME_NOW, (uint64_t)(NSEC_PER_SEC / fps), NSEC_PER_MSEC);
  __weak EO3DSCoreSession *weakSelf = self;
  dispatch_source_set_event_handler(_timer, ^{
    EO3DSCoreSession *strongSelf = weakSelf;
    if (!strongSelf || !strongSelf->_running.load() || strongSelf->_paused.load()) return;
    @autoreleasepool {
      strongSelf->_api.run();
      strongSelf->_fpsFrames += 1;
      auto now = std::chrono::steady_clock::now();
      double elapsed = std::chrono::duration<double>(now - strongSelf->_fpsWindow).count();
      if (elapsed >= 1.0) {
        strongSelf->_fps = strongSelf->_fpsFrames / elapsed;
        strongSelf->_fpsFrames = 0;
        strongSelf->_fpsWindow = now;
      }
    }
  });
  dispatch_resume(_timer);
  return YES;
}

- (void)stop {
  if (!_running.exchange(false)) return;
  dispatch_sync(_emulationQueue, ^{
    if (self->_timer) { dispatch_source_cancel(self->_timer); self->_timer = nil; }
    self->_api.unload_game();
    self->_api.deinit();
    if (self->_coreHandle) dlclose(self->_coreHandle);
    self->_coreHandle = nullptr;
    if (self->_JIT26Enabled) jit26ProtocolReady = false;
    self->_imageView = nil;
    if (activeSession == self) activeSession = nil;
  });
}

- (void)setPaused:(BOOL)paused { _paused = paused; }
- (void)setLandscape:(BOOL)landscape {
  _landscape = landscape;
  // Keep the two 3DS screens stacked in both orientations. The prior dynamic
  // switch could leave Azahar in side-by-side mode after a rotation round trip.
  _variables["citra_layout_option"] = "default";
  _variablesChanged = true;
}
- (void)setButton:(NSInteger)button pressed:(BOOL)pressed { if (button >= 0 && button < (NSInteger)_buttons.size()) _buttons[(size_t)button] = pressed; }
- (void)setTouchX:(CGFloat)x y:(CGFloat)y pressed:(BOOL)pressed {
  _touchX = (int16_t)MAX(INT16_MIN, MIN(INT16_MAX, lround((x * 2.0 - 1.0) * INT16_MAX)));
  _touchY = (int16_t)MAX(INT16_MIN, MIN(INT16_MAX, lround((y * 2.0 - 1.0) * INT16_MAX)));
  _touchPressed = pressed;
}
- (void)resetGame {
  if (!_running.load()) return;
  dispatch_async(_emulationQueue, ^{ if (self->_running.load()) self->_api.reset(); });
}

- (BOOL)saveStateToURL:(NSURL *)url error:(NSError **)error {
  if (!_running.load()) return NO;
  __block BOOL saved = NO;
  __block NSError *stateError = nil;
  dispatch_sync(_emulationQueue, ^{
    const size_t size = self->_api.serialize_size();
    if (size == 0 || size > 512 * 1024 * 1024) {
      stateError = [NSError errorWithDomain:EO3DSCoreErrorDomain code:5 userInfo:@{NSLocalizedDescriptionKey: @"Azahar could not create a bounded resume point."}];
      return;
    }
    NSMutableData *state = [NSMutableData dataWithLength:size];
    if (!self->_api.serialize(state.mutableBytes, size)) {
      stateError = [NSError errorWithDomain:EO3DSCoreErrorDomain code:6 userInfo:@{NSLocalizedDescriptionKey: @"Azahar could not serialize the current session."}];
      return;
    }
    saved = [state writeToURL:url options:NSDataWritingAtomic error:&stateError];
  });
  if (!saved && error) *error = stateError;
  return saved;
}

- (BOOL)loadStateFromURL:(NSURL *)url error:(NSError **)error {
  NSData *state = [NSData dataWithContentsOfURL:url options:NSDataReadingMappedIfSafe error:error];
  if (!state || state.length == 0 || state.length > 512 * 1024 * 1024 || !_running.load()) return NO;
  __block BOOL loaded = NO;
  dispatch_sync(_emulationQueue, ^{ loaded = self->_api.unserialize(state.bytes, state.length); });
  if (!loaded && error) *error = [NSError errorWithDomain:EO3DSCoreErrorDomain code:7 userInfo:@{NSLocalizedDescriptionKey: @"The saved resume point is incompatible or damaged."}];
  return loaded;
}
- (void)dealloc { [self stop]; }

@end
