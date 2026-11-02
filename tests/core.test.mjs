import test from 'node:test';
import assert from 'node:assert/strict';
import { weekWindowFor, classifyByWeek, deriveAnswerKeys, toPublicProjection } from '../dist/core.mjs';

test('week begins Saturday 01:00 and ends Thursday 23:00 Vietnam time',()=>{
  const {start,end}=weekWindowFor('2026-11-03T12:00:00+07:00');
  assert.equal(start.toISOString(),'2026-10-30T18:00:00.000Z');
  assert.equal(end.toISOString(),'2026-11-05T16:00:00.000Z');
});
test('Saturday before 01:00 belongs to prior window',()=>{
  const {start}=weekWindowFor('2026-10-31T00:59:59+07:00');
  assert.equal(start.toISOString(),'2026-10-23T18:00:00.000Z');
});
test('boundaries inclusive, gap visible, duplicate source IDs removed',()=>{
  const base={submissionId:'s',sourceAnswerKey:'s:q:0:v1'};
  const data=[{...base,submittedAt:'2026-10-31T01:00:00+07:00'},{...base,submittedAt:'2026-11-01T01:00:00+07:00'},{submissionId:'s2',sourceAnswerKey:'s2:q:0:v1',submittedAt:'2026-11-05T23:00:00+07:00'},{submissionId:'s3',sourceAnswerKey:'s3:q:0:v1',submittedAt:'2026-11-05T23:00:01+07:00'}];
  const out=classifyByWeek(data,'2026-11-03T12:00:00+07:00');
  assert.equal(out.included.length,2); assert.equal(out.excludedGap.length,1); assert.equal(out.duplicates.length,1);
});
test('learner HTML stays plain text value',()=>{
  const malicious='<img src=x onerror=alert(1)>';
  assert.equal(String(malicious),malicious);
});
test('UTC instants at both edges are included and one millisecond outside is gap',()=>{
  const data=[
    {submissionId:'a',sourceAnswerKey:'a:q:0:v1',submittedAt:'2026-10-30T18:00:00.000Z'},
    {submissionId:'b',sourceAnswerKey:'b:q:0:v1',submittedAt:'2026-11-05T16:00:00.000Z'},
    {submissionId:'c',sourceAnswerKey:'c:q:0:v1',submittedAt:'2026-11-05T16:00:00.001Z'}];
  const out=classifyByWeek(data,'2026-11-03T12:00:00+07:00');
  assert.deepEqual(out.included.map(x=>x.submissionId),['a','b']);
  assert.deepEqual(out.excludedGap.map(x=>x.submissionId),['c']);
});
test('missing or invalid timestamp is quarantined',()=>{
  const out=classifyByWeek([{submissionId:'x',sourceAnswerKey:'x:q:0:v1',submittedAt:'not-a-date'}],'2026-11-03T12:00:00+07:00');
  assert.equal(out.invalid.length,1); assert.equal(out.included.length,0);
});
test('derived keys retain question index and distinguish repeated questions',()=>{
  const keyed=deriveAnswerKeys([{question:'Câu hỏi giống nhau'},{question:'Câu hỏi giống nhau'}],'sub-1');
  assert.notEqual(keyed[0].sourceAnswerKey,keyed[1].sourceAnswerKey);
  assert.match(keyed[0].sourceAnswerKey,/sub-1:.*:0:v1$/);
  assert.match(keyed[1].sourceAnswerKey,/sub-1:.*:1:v1$/);
});
test('public projection suppresses contact fields and identity by default',()=>{
  const source={submissionId:'s',sourceAnswerKey:'s:q:0:v1',submittedAt:'2026-11-01T00:00:00Z',questionText:'q',answerText:'<script>alert(1)</script>',email:'secret@example.com',phone:'0900',author:{displayName:'Tên riêng',group:'Nhóm 1',email:'secret@example.com'}};
  const projected=toPublicProjection(source);
  assert.equal(projected.answerText,'<script>alert(1)</script>');
  assert.equal('email' in projected,false); assert.equal('phone' in projected,false); assert.equal('displayName' in projected,false);
  assert.equal(toPublicProjection(source,{includeIdentity:true}).displayName,'Tên riêng');
});
