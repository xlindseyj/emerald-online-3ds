#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^EO3DSRuntimeMessageHandler)(NSString *message);
typedef void (^EO3DSAudioHandler)(NSData *interleavedInt16, NSUInteger frames, double sampleRate);

FOUNDATION_EXPORT BOOL EO3DSHasGetTaskAllow(void);
FOUNDATION_EXPORT BOOL EO3DSIsDebuggerAttached(void);
FOUNDATION_EXPORT BOOL EO3DSIsJIT26ProtocolReady(void);

@interface EO3DSCoreSession : NSObject

@property(nonatomic, readonly, getter=isRunning) BOOL running;
@property(nonatomic, copy, nullable) EO3DSRuntimeMessageHandler messageHandler;
@property(nonatomic, copy, nullable) EO3DSAudioHandler audioHandler;
@property(nonatomic, readonly) double framesPerSecond;
@property(nonatomic, readonly) NSUInteger videoFramesReceived;
@property(nonatomic, readonly) BOOL hasNonBlackVideoFrame;
@property(nonatomic, readonly) NSUInteger audioFramesReceived;
@property(nonatomic, readonly, getter=isJITEnabled) BOOL JITEnabled;

- (instancetype)initWithCoreURL:(NSURL *)coreURL
                      runtimeURL:(NSURL *)runtimeURL
                       userRootURL:(NSURL *)userRootURL
                        jitEnabled:(BOOL)jitEnabled NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

- (BOOL)startInImageView:(UIImageView *)imageView error:(NSError **)error;
- (void)stop;
- (void)setPaused:(BOOL)paused;
- (void)setLandscape:(BOOL)landscape;
- (void)setButton:(NSInteger)button pressed:(BOOL)pressed;
- (void)setTouchX:(CGFloat)x y:(CGFloat)y pressed:(BOOL)pressed;
- (void)resetGame;
- (BOOL)saveStateToURL:(NSURL *)url error:(NSError **)error NS_SWIFT_NAME(saveState(to:));
- (BOOL)loadStateFromURL:(NSURL *)url error:(NSError **)error NS_SWIFT_NAME(loadState(from:));

@end

NS_ASSUME_NONNULL_END
