// Re-verifies every transaction in sent.jsonl against the chain and prints a Markdown table.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, formatEther } from "viem";
const HERE = new URL(".", import.meta.url).pathname;
const c = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
const RF = "0x0779369854d3ecdea927206718ffd7730c67b71f", ZERO = "0x" + "0".repeat(64);
const NAMES = { "0x095ea7b3": "approve RF", "0x9f68c98a": "hardwire", "0xe0622b27": "upgrade", "0xa9059cbb": "RF transfer", "0x996cba68": "claim", "0x51945447": "ERC-6551 execute", "0x5455429e": "promote" };
const rows = readFileSync(resolve(HERE, "sent.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
let total = 0;
console.log("| # | Block | Call | Tagged | RF burned | Tx |\n|---|---|---|---|---|---|");
for (const [i, r] of rows.entries()) {
  const [tx, rc] = await Promise.all([c.getTransaction({ hash: r.hash }), c.getTransactionReceipt({ hash: r.hash })]);
  const burned = rc.logs.filter((l) => l.address.toLowerCase() === RF && l.topics[0].startsWith("0xddf252ad") && l.topics[2] === ZERO).reduce((s, l) => s + BigInt(l.data), 0n);
  total += Number(formatEther(burned));
  const sel = tx.input.slice(0, 10);
  console.log(`| ${i + 1} | ${rc.blockNumber} | ${NAMES[sel] ?? sel} | ${tx.input.endsWith("4e4553540001") ? "yes" : "no"} | ${formatEther(burned)} | [${r.hash.slice(0, 10)}…](https://robinhoodchain.blockscout.com/tx/${r.hash}) ${rc.status === "success" ? "" : "REVERTED"} |`);
}
console.log(`\nTotal RF burned: ${total}`);
