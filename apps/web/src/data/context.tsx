import { createContext, useContext, type ReactNode } from "react";
import { createLiveSource } from "./live.js";
import type { NestDataSource } from "./source.js";

const liveSource = createLiveSource();
const Ctx = createContext<NestDataSource>(liveSource);

/** Routes wrap their tree in this to choose the source; the default is the live one. */
export function DataSourceProvider({ source, children }: { source: NestDataSource; children: ReactNode }) {
  return <Ctx.Provider value={source}>{children}</Ctx.Provider>;
}

export function useDataSource(): NestDataSource {
  return useContext(Ctx);
}
