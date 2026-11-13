// The slice of FFmpeg's API the decoders use. The code behind it is MPVKit's FFmpeg (LGPL), which the app
// links for the built-in player: these headers are its own, so the types match the library that runs.
#include "libavcodec/avcodec.h"
#include "libavutil/channel_layout.h"
#include "libavutil/frame.h"
#include "libavutil/samplefmt.h"
