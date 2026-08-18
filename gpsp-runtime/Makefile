.SUFFIXES:

ifeq ($(strip $(DEVKITARM)),)
$(error "Please set DEVKITARM")
endif

TOPDIR ?= $(CURDIR)
include $(DEVKITARM)/3ds_rules

TARGET      := emerald-online-3ds
BUILD       := build
SOURCES     := source source/ui source/network
INCLUDES    := include source ../third_party/gpsp/libretro/libretro-common/include $(DEVKITPRO)/portlibs/3ds/include
ARCH        := -march=armv6k -mtune=mpcore -mfloat-abi=hard -mtp=soft
CFLAGS      := -O3 -Wall -Wextra -mword-relocations -ffunction-sections $(ARCH) $(INCLUDE) -D__3DS__ -DUSE_CTRULIB_2
CXXFLAGS    := $(CFLAGS) -fno-rtti -fno-exceptions -std=gnu++17
ASFLAGS     := -g $(ARCH)
LDFLAGS     := -specs=3dsx.specs $(ARCH) -Wl,-Map,$(notdir $*.map),--gc-sections
LIBS        := $(TOPDIR)/../third_party/gpsp/gpsp_libretro_ctr.a -lmbedtls -lmbedx509 -lmbedcrypto -lcitro2d -lcitro3d -lctru -lm
LIBDIRS     := $(CTRULIB) $(DEVKITPRO)/portlibs/3ds
APP_TITLE   := Emerald Online 3DS
APP_DESCRIPTION := Old 3DS dynarec dual-screen online runtime
APP_AUTHOR  := Emerald Online 3DS
ICON        := ../assets/emerald-online-3ds-icon.png

ifneq ($(BUILD),$(notdir $(CURDIR)))
export OUTPUT := $(CURDIR)/$(TARGET)
export TOPDIR := $(CURDIR)
export VPATH := $(foreach dir,$(SOURCES),$(CURDIR)/$(dir))
export DEPSDIR := $(CURDIR)/$(BUILD)
CPPFILES := $(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.cpp)))
CFILES := ctr_svchax.c
export OFILES := $(CPPFILES:.cpp=.o) $(CFILES:.c=.o)
export INCLUDE := $(foreach dir,$(INCLUDES),-I$(CURDIR)/$(dir)) $(foreach dir,$(LIBDIRS),-I$(dir)/include) -I$(CURDIR)/$(BUILD)
export LIBPATHS := $(foreach dir,$(LIBDIRS),-L$(dir)/lib)
export LD := $(CXX)
ifneq ($(wildcard $(TOPDIR)/$(ICON)),)
export APP_ICON := $(TOPDIR)/$(ICON)
endif
export _3DSXFLAGS += --smdh=$(CURDIR)/$(TARGET).smdh
.PHONY: all clean
all: $(BUILD)
	@$(MAKE) --no-print-directory -C $(BUILD) -f $(CURDIR)/Makefile
$(BUILD):
	@mkdir -p $@
clean:
	@rm -rf $(BUILD) $(TARGET).3dsx $(TARGET).smdh $(TARGET).elf
else
$(OUTPUT).3dsx: $(OUTPUT).elf $(OUTPUT).smdh
$(OUTPUT).elf: $(OFILES)
-include $(DEPSDIR)/*.d
endif
