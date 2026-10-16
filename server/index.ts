import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { loadCatalog } from "../src/model/catalog.ts";
import { admin } from "./supabase.ts";
import { BattleRoom } from "./BattleRoom.ts";

await loadCatalog(admin); // classes/cards from the catalog tables, same as the browser

const server = new Server({ transport: new WebSocketTransport() });
server.define("battle", BattleRoom);

const port = Number(process.env.PORT ?? 2567); // Railway sets PORT
await server.listen(port);
console.log(`Colyseus listening on :${port}`);
