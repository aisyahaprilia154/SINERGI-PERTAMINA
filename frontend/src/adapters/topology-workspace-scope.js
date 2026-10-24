// One owner for a mounted workspace, including future worker-backed renderers.
export function createTopologyWorkspaceScope(host=window) {
  const controller=new AbortController(),cleanups=new Set(),timers=new Set(),frames=new Set()
  const scope={
    signal:controller.signal,
    get disposed(){return controller.signal.aborted},
    own(dispose){if(scope.disposed)dispose();else cleanups.add(dispose);return dispose},
    listen(target,type,listener,options){
      if(!target||scope.disposed)return
      target.addEventListener(type,listener,options)
      scope.own(()=>target.removeEventListener(type,listener,options))
    },
    timeout(callback,delay){if(scope.disposed)return null;const id=host.setTimeout(()=>{timers.delete(id);if(!scope.disposed)callback()},delay);timers.add(id);return id},
    clearTimeout(id){host.clearTimeout(id);timers.delete(id)},
    frame(callback){if(scope.disposed)return null;const id=host.requestAnimationFrame(time=>{frames.delete(id);if(!scope.disposed)callback(time)});frames.add(id);return id},
    cancelFrame(id){host.cancelAnimationFrame(id);frames.delete(id)},
    observe(observer,target){if(scope.disposed){observer.disconnect();return};observer.observe(target);scope.own(()=>observer.disconnect())},
    worker(worker){scope.own(()=>worker.terminate());return worker},
    dispose(){
      if(scope.disposed)return
      controller.abort()
      for(const id of timers)host.clearTimeout(id)
      for(const id of frames)host.cancelAnimationFrame(id)
      timers.clear();frames.clear()
      for(const cleanup of [...cleanups].reverse())cleanup()
      cleanups.clear()
    },
  }
  scope.listen(host,'pagehide',()=>scope.dispose(),{once:true})
  return scope
}
