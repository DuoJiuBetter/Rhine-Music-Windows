import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {isolatedProfileArgument} from './native-benchmark-host.mjs';

test('WebView profile boundary accepts EBWebView and quoted paths, rejects siblings and defaults',()=>{
 const profile=path.resolve('artifacts/benchmark/unit-profile');
 for(const actual of [profile,path.join(profile,'EBWebView')]) {
  assert.equal(isolatedProfileArgument(['--user-data-dir='+actual],profile),true);
  assert.equal(isolatedProfileArgument(['--user-data-dir="'+actual+'"'],profile),true);
 }
 assert.equal(isolatedProfileArgument(['--user-data-dir='+profile+'-other'],profile),false);
 assert.equal(isolatedProfileArgument(['--user-data-dir='+path.dirname(profile)],profile),false);
 assert.equal(isolatedProfileArgument([],profile),false);
});
