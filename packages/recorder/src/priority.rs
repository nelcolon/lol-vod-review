//! Step aside for the game: below-normal CPU priority class and below-normal GPU
//! scheduling priority for the whole recorder process. The GPU scheduler then serves the
//! game's work first; the capture copy and the encoder still get the idle time, which at
//! 1440p60 is a few percent of one engine.

use windows::Wdk::Graphics::Direct3D::{D3DKMTSetProcessSchedulingPriorityClass, D3DKMT_SCHEDULINGPRIORITYCLASS_BELOW_NORMAL};
use windows::Win32::System::Threading::{GetCurrentProcess, SetPriorityClass, BELOW_NORMAL_PRIORITY_CLASS};

pub fn lower() {
    unsafe {
        let me = GetCurrentProcess();
        let _ = SetPriorityClass(me, BELOW_NORMAL_PRIORITY_CLASS);
        let _ = D3DKMTSetProcessSchedulingPriorityClass(me, D3DKMT_SCHEDULINGPRIORITYCLASS_BELOW_NORMAL);
    }
}
