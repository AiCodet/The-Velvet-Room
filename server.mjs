import {createApp} from './backend/http.mjs';
const app=await createApp({dbPath:process.env.DATABASE_PATH});
const port=Number(process.env.PORT??4173),host=process.env.HOST??'127.0.0.1';
app.server.listen(port,host,()=>console.log(`The Velvet Room is ready at http://${host}:${app.server.address().port} · persistent backend connected`));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{app.close().then(()=>process.exit(0));setTimeout(()=>process.exit(1),8000).unref();});
