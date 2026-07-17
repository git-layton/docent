use core_graphics::window::{CGWindowListCopyWindowInfo, kCGWindowListOptionOnScreenOnly, kCGNullWindowID, kCGWindowListExcludeDesktopElements};
use core_foundation::array::CFArray;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use core_foundation::number::CFNumber;
use core_foundation::base::TCFType;

#[derive(serde::Serialize)]
pub struct WindowInfo {
    pub id: u32,
    pub app: String,
    pub title: String,
}

pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
    let mut windows = Vec::new();
    unsafe {
        let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
        let window_info = CGWindowListCopyWindowInfo(options, kCGNullWindowID);
        if window_info.is_null() {
            return Err("Failed".into());
        }
        let array = CFArray::<CFDictionary>::wrap_under_create_rule(window_info);
        
        let k_owner_name = CFString::new("kCGWindowOwnerName");
        let k_name = CFString::new("kCGWindowName");
        let k_number = CFString::new("kCGWindowNumber");
        let k_layer = CFString::new("kCGWindowLayer");
        
        for i in 0..array.len() {
            // get returns a reference to the element
            let dict = array.get(i).unwrap(); // wait, CFArray::get returns the T if it's clonable or a pointer?
            // CFDictionary is TCFType.
            // actually we can just iterate `for dict in array.iter()` maybe? Let's check docs or just use `get` or pointer cast.
            
            // We'll write the raw pointer cast loop just to be safe if types are weird.
            let dict_ref = array.get(i).unwrap(); 
            
            // To find in dict, we need CFTypeRef.
            let layer_ref = dict.find(k_layer.as_CFTypeRef() as *const _);
            if let Some(l) = layer_ref {
                // layer_ref is *const c_void
                let cf_num = CFNumber::wrap_under_get_rule(*l as _);
                if cf_num.to_i32() != Some(0) {
                    continue;
                }
            }
        }
    }
    Ok(windows)
}
fn main() {}
