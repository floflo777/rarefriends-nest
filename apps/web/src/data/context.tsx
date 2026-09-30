import { createContext, useContext, type ReactNode } from "react";
import { createNestClient, type NestClient } from "@nest/core";
import { createLiveSource } from "./live.js";
import type { NestDataSource } from "./source.js";

/** One viem client for the whole app: shared HTTP batching keeps the public RPC under its limit. */
export const nestClient: NestClient = createNestClient();
export const liveSource = createLiveSource(nestClient);
const Ctx = createContext<NestDataSource>(liveSource);

/** Routes wrap their tree in this to choose the source; the default is the live one. */
export function DataSourceProvider({ source, children }: { source: NestDataSource; children: ReactNode }) {
  return <Ctx.Provider value={source}>{children}</Ctx.Provider>;
}

export function useDataSource(): NestDataSource {
  return useContext(Ctx);
}
