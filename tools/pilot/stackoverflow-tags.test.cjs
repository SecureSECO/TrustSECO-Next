const {test}=require('node:test'),assert=require('node:assert/strict');
const {stackOverflowTag}=require('./stackoverflow-tags.cjs');
const {targets}=require('./collection-plan.cjs');
test('reviewed aliases work without altering the queue; ambiguous and nonexistent tags remain absent',()=>{
 const p={repository:'psf/requests',name:'requests',platform:'Pypi',version:'1'};
 assert.equal(stackOverflowTag(p),'python-requests');assert.equal(p.stackOverflowTag,undefined);
 assert.equal(stackOverflowTag({...p,repository:'someone/requests'}),undefined);
 assert.equal(stackOverflowTag({repository:'cloudpipe/cloudpickle',name:'cloudpickle',platform:'Pypi'}),undefined);
 const task=targets('n',[p],[],1).find(t=>t.metric==='so_popularity');assert.equal(task.event.stackOverflowTag,'python-requests');assert.equal(task.ready,true);
});
