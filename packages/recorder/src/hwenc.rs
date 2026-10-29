//! Report which hardware video encoder MFT Media Foundation would pick.
//!
//! `windows-capture` creates a `MediaTranscoder` with hardware acceleration
//! enabled and lets MF choose the MFT, so we cannot read back which one it
//! used. Enumerating hardware encoders for the requested subtype tells the
//! core (and the bake-off) whether an NVENC/AMF/QSV MFT exists at all.

use windows::core::{GUID, PWSTR};
use windows::Win32::Media::MediaFoundation::{
    IMFActivate, MFShutdown, MFStartup, MFTEnumEx, MFMediaType_Video, MFVideoFormat_H264, MFVideoFormat_HEVC,
    MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE, MFT_ENUM_FLAG_SORTANDFILTER, MFT_FRIENDLY_NAME_Attribute,
    MFT_REGISTER_TYPE_INFO, MFSTARTUP_FULL,
};
use windows::Win32::System::Com::CoTaskMemFree;

use crate::protocol::Codec;

const MF_VERSION: u32 = (2u32 << 16) | 0x70;

/// Friendly names of all hardware encoder MFTs for `codec` (MF merit order,
/// `;`-separated), if any. MF picks the first that accepts the input.
pub fn hardware_encoder_name(codec: Codec) -> Option<String> {
    let subtype: GUID = match codec {
        Codec::H264 => MFVideoFormat_H264,
        Codec::Hevc => MFVideoFormat_HEVC,
    };
    unsafe {
        // MFStartup is reference counted; pairing it with MFShutdown here keeps
        // us from disturbing the encoder's own MF session.
        if MFStartup(MF_VERSION, MFSTARTUP_FULL).is_err() {
            return None;
        }
        let out_type = MFT_REGISTER_TYPE_INFO {
            guidMajorType: MFMediaType_Video,
            guidSubtype: subtype,
        };
        let mut activates: *mut Option<IMFActivate> = std::ptr::null_mut();
        let mut count: u32 = 0;
        let res = MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            None,
            Some(&out_type),
            &mut activates,
            &mut count,
        );
        let mut names: Vec<String> = Vec::new();
        if res.is_ok() && !activates.is_null() {
            let slice = std::slice::from_raw_parts_mut(activates, count as usize);
            for item in slice.iter_mut() {
                if let Some(act) = item.take() {
                    let mut p = PWSTR::null();
                    let mut len = 0u32;
                    if act.GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut p, &mut len).is_ok() && !p.is_null() {
                        names.push(String::from_utf16_lossy(std::slice::from_raw_parts(p.0, len as usize)));
                        CoTaskMemFree(Some(p.0 as *const _));
                    }
                }
            }
            CoTaskMemFree(Some(activates as *const _));
        }
        let name = if names.is_empty() { None } else { Some(names.join("; ")) };
        let _ = MFShutdown();
        name
    }
}
