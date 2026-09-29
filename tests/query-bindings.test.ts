import assert from "node:assert/strict";
import {readdirSync,readFileSync} from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

function files(directory:string):string[]{return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const name=path.join(directory,entry.name);return entry.isDirectory()?files(name):/\.tsx?$/.test(name)?[name]:[]})}

test("literal PostgreSQL queries bind every placeholder exactly once",()=>{
 const problems:string[]=[];let checked=0;
 for(const file of [...files("app"),...files("lib")]){
  const source=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true,file.endsWith("tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  function visit(node:ts.Node){
   if(ts.isCallExpression(node)&&((ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==="query")||(file==="app/pms/page.tsx"&&ts.isIdentifier(node.expression)&&node.expression.text==="query"))&&node.arguments.length>=2){
    const [sql,parameters]=node.arguments;
    if((ts.isStringLiteral(sql)||ts.isNoSubstitutionTemplateLiteral(sql))&&ts.isArrayLiteralExpression(parameters)){
     const placeholders=[...sql.text.matchAll(/\$(\d+)/g)].map(match=>Number(match[1]));
     const expected=placeholders.length?Math.max(...placeholders):0;checked++;
     if(expected!==parameters.elements.length)problems.push(`${file}:${source.getLineAndCharacterOfPosition(node.pos).line+1} expects ${expected}, binds ${parameters.elements.length}`);
    }
   }
   ts.forEachChild(node,visit);
  }
  visit(source);
 }
 assert.ok(checked>180,`checked ${checked} SQL calls`);assert.deepEqual(problems,[]);
});
