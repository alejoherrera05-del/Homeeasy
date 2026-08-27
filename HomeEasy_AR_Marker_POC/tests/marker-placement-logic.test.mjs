import assert from "node:assert/strict";
import {MarkerPlaneOffsets,MarkerStateMachine,STATES,computeInstallationMountPoint,POC_CONTRACT,PRODUCT_CONFIGURATION} from "../production/marker-placement-poc.js";

const transitions=[];
const machine=new MarkerStateMachine({foundHoldMs:100,onChange:event=>transitions.push(event.state)});
assert.equal(machine.state,STATES.INITIALIZING);
machine.setCameraReady();assert.equal(machine.state,STATES.SEARCHING_MARKER);
machine.observeMarker(true,1000);assert.equal(machine.state,STATES.MARKER_FOUND);
machine.observeMarker(true,1101);assert.equal(machine.state,STATES.TRACKING);
machine.observeMarker(false,1200);assert.equal(machine.state,STATES.MARKER_LOST);
machine.observeMarker(true,1300);assert.equal(machine.state,STATES.MARKER_FOUND);

const offsets=new MarkerPlaneOffsets();offsets.setStep(.05);offsets.move(1,-1);assert.deepEqual(offsets.snapshot(),{offsetX:.05,offsetY:-.05,offsetZ:.005,rotationOffset:0,stepM:.05});offsets.farther();assert.equal(offsets.snapshot().offsetZ,.015);offsets.closer();assert.equal(offsets.snapshot().offsetZ,.005);offsets.center();assert.equal(offsets.snapshot().offsetX,0);offsets.reset();assert.equal(offsets.snapshot().rotationOffset,0);

const box=(min,max)=>({min:{x:min[0],y:min[1],z:min[2]},max:{x:max[0],y:max[1],z:max[2]},isEmpty:()=>false});
const mount=computeInstallationMountPoint(box([-0.5,0,-.04],[.5,2.2,.09]),box([-.51,2.15,-.04],[.51,2.24,.02]));assert.deepEqual(mount.mountPointM,[0,2.24,-.04]);assert.equal(mount.minimumClearanceM,0);assert.equal(mount.wallPlaneTestPassed,true);
assert.throws(()=>computeInstallationMountPoint(box([-.5,0,-.06],[.5,2.2,.09]),box([-.51,2.15,-.04],[.51,2.24,.02])),/detrás del plano/);
assert.equal(POC_CONTRACT.markerSizeM,.18);assert.equal(POC_CONTRACT.autoScale,false);assert.equal(POC_CONTRACT.quickLook,false);assert.equal(PRODUCT_CONFIGURATION.widthM,1);assert.equal(PRODUCT_CONFIGURATION.heightM,2.2);assert.equal(PRODUCT_CONFIGURATION.position,"closed");
assert.deepEqual(transitions.slice(0,6),[STATES.INITIALIZING,STATES.SEARCHING_MARKER,STATES.MARKER_FOUND,STATES.TRACKING,STATES.MARKER_LOST,STATES.MARKER_FOUND]);
console.log("marker-placement-logic: PASS");
