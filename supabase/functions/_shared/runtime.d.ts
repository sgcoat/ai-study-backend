declare const Deno: {
  env:{get(name:string):string|undefined};
  serve(handler:(request:Request)=>Response|Promise<Response>):unknown;
};
declare const EdgeRuntime:{waitUntil(task:Promise<unknown>):void};
