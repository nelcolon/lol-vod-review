//! Serialised JSON-lines writer for stdout, shared by the main loop, the
//! capture thread and the audio thread.

use std::io::Write;
use std::sync::Arc;

use parking_lot::Mutex;

use crate::protocol::{encode_event, Event};

#[derive(Clone)]
pub struct Emitter {
    out: Arc<Mutex<std::io::Stdout>>,
}

impl Default for Emitter {
    fn default() -> Self {
        Self::new()
    }
}

impl Emitter {
    pub fn new() -> Self {
        Emitter {
            out: Arc::new(Mutex::new(std::io::stdout())),
        }
    }

    pub fn emit(&self, ev: &Event) {
        let line = encode_event(ev);
        let mut o = self.out.lock();
        let _ = writeln!(o, "{line}");
        let _ = o.flush();
    }
}
