import * as lancedb from "@lancedb/lancedb";
const db = await lancedb.connect("/tmp/e3-smoke.lance");
console.log("lancedb ok", db);
