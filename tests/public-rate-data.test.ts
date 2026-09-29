import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source=readFileSync("lib/public-rate.ts","utf8");
const file=ts.createSourceFile("public-rate.ts",source,ts.ScriptTarget.Latest,true);
const helpers=file.statements.filter(node=>ts.isFunctionDeclaration(node)&&["jsonArray","translatedText"].includes(node.name?.text??""));
assert.equal(helpers.length,2);
const compiled=ts.transpileModule(helpers.map(node=>node.getText(file)).join("\n"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exports:Record<string,(...args:unknown[])=>unknown>={};
vm.runInNewContext(compiled,{exports,JSON,String,Array});
const {jsonArray,translatedText}=exports;

test("availability tolerates nullable and malformed JSON fields from existing hotel records",()=>{
  for(const value of [null,"null","{}","42","\"room\"",{bad:true},"not-json"]){
    assert.deepEqual(Array.from(jsonArray(value) as unknown[]),[]);
  }
  assert.deepEqual(Array.from(jsonArray('["101","102"]') as unknown[]),["101","102"]);
  assert.deepEqual(Array.from(jsonArray([1,2]) as unknown[]),[1,2]);
});

test("availability ignores invalid translations and retains a readable fallback",()=>{
  for(const value of ['{"en":42}', '{"en":null}', '{"en":{}}',"null","broken"]){
    assert.equal(translatedText(value,"en","Ελληνικά","English","fallback"),"English");
  }
  assert.equal(translatedText('{"el":"  Δωμάτιο  "}',"el","Ελληνικά","English","fallback"),"Δωμάτιο");
});
