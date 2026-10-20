import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFileSync} from 'node:child_process';
import {normalizeWindowDisplayMode,windowExpandAction} from '../src/window-display-mode.ts';

test('only maximize/fullscreen are preferences; legacy windowed and corrupt data default to maximize',()=>{
  for(const value of [undefined,null,'windowed','bad',12,{},'maximized'])assert.equal(normalizeWindowDisplayMode(value),'maximized');
  assert.equal(normalizeWindowDisplayMode('fullscreen'),'fullscreen');
});
test('middle button enters the preferred mode and always restores an expanded window',()=>{
  for(const mode of ['maximized','fullscreen']){
    assert.equal(windowExpandAction(mode,{fullscreen:false,maximized:false}),mode==='fullscreen'?'enter-fullscreen':'maximize-window');
    for(const state of [{fullscreen:false,maximized:true},{fullscreen:true,maximized:false},{fullscreen:true,maximized:true}])assert.equal(windowExpandAction(mode,state),'restore');
  }
});
test('production Rust helper clears maximization before fullscreen and propagates native failures',{skip:process.platform!=='win32'},async()=>{
  const source=(await fs.readFile('src-tauri/src/main.rs','utf8')).replaceAll('\r\n','\n');
  const start=source.indexOf('fn enter_window_fullscreen('),end=source.indexOf('\n#[tauri::command]',start);
  assert.ok(start>=0&&end>start);const helper=source.slice(start,end);
  const directory=path.resolve('artifacts/window-display-mode');await fs.mkdir(directory,{recursive:true});
  const fixture=`use std::cell::{Cell,RefCell};
mod tauri {pub type Result<T> = std::result::Result<T, &'static str>;}
struct WebviewWindow{max:Cell<bool>,full:Cell<bool>,log:RefCell<Vec<&'static str>>,fail:&'static str}
impl WebviewWindow{
 fn new(max:bool,full:bool,fail:&'static str)->Self{Self{max:Cell::new(max),full:Cell::new(full),log:RefCell::new(vec![]),fail}}
 fn is_fullscreen(&self)->tauri::Result<bool>{Ok(self.full.get())}
 fn unmaximize(&self)->tauri::Result<()>{self.log.borrow_mut().push("unmaximize");if self.fail=="unmaximize"{return Err("unmaximize")}self.max.set(false);Ok(())}
 fn set_fullscreen(&self,value:bool)->tauri::Result<()>{self.log.borrow_mut().push("fullscreen");assert!(!self.max.get(),"rcWork would clip a still-maximized client");if self.fail=="fullscreen"{return Err("fullscreen")}self.full.set(value);Ok(())}
 fn set_focus(&self)->tauri::Result<()>{self.log.borrow_mut().push("focus");if self.fail=="focus"{Err("focus")}else{Ok(())}}
}
${helper}
#[test]fn maximize_to_fullscreen(){let w=WebviewWindow::new(true,false,"");enter_window_fullscreen(&w).unwrap();assert_eq!(*w.log.borrow(),vec!["unmaximize","fullscreen","focus"]);assert!(w.full.get());assert!(!w.max.get());}
#[test]fn normal_to_fullscreen(){let w=WebviewWindow::new(false,false,"");enter_window_fullscreen(&w).unwrap();assert!(w.full.get());}
#[test]fn already_fullscreen_only_focuses(){let w=WebviewWindow::new(false,true,"");enter_window_fullscreen(&w).unwrap();assert_eq!(*w.log.borrow(),vec!["focus"]);}
#[test]fn failed_unmaximize_stops(){let w=WebviewWindow::new(true,false,"unmaximize");assert_eq!(enter_window_fullscreen(&w),Err("unmaximize"));assert_eq!(*w.log.borrow(),vec!["unmaximize"]);assert!(!w.full.get());}
#[test]fn failed_fullscreen_stops(){let w=WebviewWindow::new(true,false,"fullscreen");assert_eq!(enter_window_fullscreen(&w),Err("fullscreen"));assert_eq!(*w.log.borrow(),vec!["unmaximize","fullscreen"]);assert!(!w.full.get());}
#[test]fn focus_failure_propagates(){let w=WebviewWindow::new(true,false,"focus");assert_eq!(enter_window_fullscreen(&w),Err("focus"));assert!(w.full.get());}
`;
  const input=path.join(directory,'native_helper.rs'),executable=path.join(directory,'native-helper-tests.exe');
  await fs.writeFile(input,fixture);
  const rustc=path.join(os.homedir(),'.cargo','bin','rustc.exe');
  execFileSync(rustc,['--edition=2021','--test',input,'-C','debuginfo=0','-o',executable],{encoding:'utf8',windowsHide:true,timeout:30000});
  const output=execFileSync(executable,[],{encoding:'utf8',windowsHide:true,timeout:10000});assert.match(output,/6 passed; 0 failed/);
  await fs.writeFile(path.join(directory,'native-helper-result.txt'),output);
});
