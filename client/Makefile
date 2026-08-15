ifeq ($(strip $(DEVKITARM)),)
$(error "Please set DEVKITARM in your environment. export DEVKITARM=<path to>devkitARM")
endif
include $(DEVKITARM)/3ds_rules
TARGET := emerald-online-3ds
BUILD := build
SOURCES := source
INCLUDES := include
ARCH := -march=armv6k -mtune=mpcore -mfloat-abi=hard -mtp=soft
CFLAGS := -g -Wall -O2 -mword-relocations -ffunction-sections $(ARCH) $(INCLUDE)
CFLAGS += $(INCLUDE)
CFLAGS += -D__3DS__
ifneq ($(strip $(SERVER_HOST)),)
CFLAGS += -DGAME_SERVER_HOST=\"$(SERVER_HOST)\"
endif
CXXFLAGS := $(CFLAGS) -fno-rtti -fno-exceptions -std=gnu++11
ASFLAGS := -g $(ARCH)
LDFLAGS = -specs=3dsx.specs -g $(ARCH) -Wl,-Map,$(notdir $*.map)
LIBS := -lctru -lm
LIBDIRS := $(CTRULIB)
ifneq ($(BUILD),$(notdir $(CURDIR)))
export OUTPUT := $(CURDIR)/$(TARGET)
export TOPDIR := $(CURDIR)
export VPATH := $(foreach dir,$(SOURCES),$(CURDIR)/$(dir))
export DEPSDIR := $(CURDIR)/$(BUILD)
CFILES := $(foreach dir,$(SOURCES),$(notdir $(wildcard $(dir)/*.c)))
export LD := $(CC)
export OFILES := $(CFILES:.c=.o)
export APP_TITLE := Emerald Online 3DS
export APP_DESCRIPTION := Dual-screen online RPG prototype
export APP_AUTHOR := Community clean-room project
export _3DSXDEPS := $(OUTPUT).smdh
export _3DSXFLAGS += --smdh=$(OUTPUT).smdh
export INCLUDE := $(foreach dir,$(INCLUDES),-I$(CURDIR)/$(dir)) $(foreach dir,$(LIBDIRS),-I$(dir)/include) -I$(CURDIR)/$(BUILD)
export LIBPATHS := $(foreach dir,$(LIBDIRS),-L$(dir)/lib)
.PHONY: all clean
all: $(BUILD)
	@$(MAKE) --no-print-directory -C $(BUILD) -f $(CURDIR)/Makefile
$(BUILD):
	@mkdir -p $@
clean:
	@echo clean ...
	@rm -fr $(BUILD) $(TARGET).3dsx $(TARGET).smdh $(TARGET).elf $(TARGET).map
else
DEPENDS := $(OFILES:.o=.d)
$(OUTPUT).3dsx: $(OUTPUT).elf $(OUTPUT).smdh
$(OUTPUT).elf: $(OFILES)
-include $(DEPENDS)
endif
