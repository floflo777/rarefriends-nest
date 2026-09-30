/**
 * Rare Friends protocol on Robinhood Chain. Every address and signature here was
 * verified against the public RPC on 2026-09-30 (see docs/dry-run.md). Nothing is
 * deployed by Nest; these are the existing protocol contracts.
 */
import { parseAbi } from "viem";

export const CHAIN_ID = 4663 as const;
export const RPC_URL = "https://rpc.mainnet.chain.robinhood.com" as const;
export const EXPLORER_URL = "https://robinhoodchain.blockscout.com" as const;

export const ADDRESSES = {
  rf: "0x0779369854d3EcdEA927206718FFD7730C67B71f",
  weth: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
  generations: "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D",
  genesis: "0x116eaa62241751e0c98da43d458600c6c17cd361",
  activationManager: "0xd4a35e11318e3679168d409184b788bcf9f283ac",
  familiesRegistry: "0x246E3E9730A7Eade94c79be0Fd78d210f89AEb8D",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  zero: "0x0000000000000000000000000000000000000000",
} as const;

/** ERC-20 subset used for RF and WETH. */
export const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/**
 * Generations (ERC-721 with temporary Friends). `ownerOf` reverts for temporary
 * (generation 0) Friends; `generation` returns 0 for them. `denomination(g)` is the
 * hardwire price for generation g in RF wei. `temporaryFriend(owner)` is the id of the
 * owner's current temporary Friend or 0.
 */
export const GENERATIONS_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function generation(uint256 tokenId) view returns (uint8)",
  "function denomination(uint8 generation) view returns (uint256)",
  "function temporaryFriend(address owner) view returns (uint256)",
  "function tokenBoundAccount(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function activationManager() view returns (address)",
  "function token() view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

/** Genesis (ERC-721, 1,024 fixed supply, 8x8 portraits). */
export const GENESIS_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenBoundAccount(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

/**
 * ActivationManager. Verified shapes:
 *  - positions(collection, id) -> (uint8 tier, uint256 weight); weight > 0 means active.
 *  - earned(asset, collection, id) -> uint256 claimable of `asset` for that NFT.
 *  - streams(asset) -> 6 words; [0] = amount of the current 7-day stream, [2] = periodFinish (unix s),
 *    [3] = lastUpdate (unix s). Other words are not relied upon.
 *  - cumulativeBps(tier) -> 10000, 15000, 22500, 33750, 50625 for tiers 0..4.
 *  - Paid actions pull RF via transferFrom: `approve(activationManager, cost)` first.
 *    Revert selector 0xfb8f41b2 = ERC20InsufficientAllowance(spender, allowance, needed).
 *  - Event Hardwired(address indexed holder, uint256 indexed tokenId, uint8 generation).
 *  - Burns: RF Transfer(from = activationManager, to = 0x0) in the same transaction.
 */
export const ACTIVATION_MANAGER_ABI = parseAbi([
  "function positions(address collection, uint256 tokenId) view returns (uint8 tier, uint256 weight)",
  "function earned(address asset, address collection, uint256 tokenId) view returns (uint256)",
  "function totalWeight() view returns (uint256)",
  "function streams(address asset) view returns (uint256 amount, uint256 w1, uint256 periodFinish, uint256 lastUpdate, uint256 w4, uint256 w5)",
  "function cumulativeBps(uint8 tier) view returns (uint256)",
  "function GENESIS_DENOMINATION() view returns (uint256)",
  "function rf() view returns (address)",
  "function weth() view returns (address)",
  "function generations() view returns (address)",
  "function genesis() view returns (address)",
  "function claim(address asset, address collection, uint256 tokenId)",
  "function claimBatch(address asset, address[] collections, uint256[] tokenIds)",
  "function hardwire(uint8 generation)",
  "function promote(uint256 tokenId)",
  "function upgrade(address collection, uint256 tokenId)",
  "function activate(address collection, uint256 tokenId)",
  "event Hardwired(address indexed holder, uint256 indexed tokenId, uint8 generation)",
]);

/** Families registry: on-chain sprites. seedOf(id) == id today; familyOf(id) in 0..8. */
export const FAMILIES_REGISTRY_ABI = parseAbi([
  "function familyOf(uint256 tokenId) pure returns (uint8)",
  "function seedOf(uint256 tokenId) pure returns (uint32)",
  "function familyName(uint8 id) pure returns (string)",
  "function frames(uint8 id, uint32 seed) view returns (uint256[64])",
  "function portrait(uint8 id, uint32 seed) view returns (uint256)",
]);

export const FAMILY_NAMES = ["Skeleton", "Mask", "Family", "Cellular", "Asymmetry", "Hoverer", "Colossus", "Sparkling", "Hollow"] as const;
export type FamilyName = (typeof FAMILY_NAMES)[number];

/** Function selectors of paid/claim actions, used to classify burn transactions. */
export const ACTION_SELECTORS = {
  "0x9f68c98a": "hardwire",
  "0x5455429e": "promote",
  "0xe0622b27": "upgrade",
  "0xca11be69": "activate",
  "0x996cba68": "claim",
  "0x3b76f8d8": "claimBatch",
} as const;
export type ActionName = (typeof ACTION_SELECTORS)[keyof typeof ACTION_SELECTORS];

/** Protocol economics from the docs, cross-checked on chain (positions weights, revert costs). RF units, not wei. */
export const DENOMINATION_RF: Record<number, number> = { 1: 100_000, 2: 10_000, 3: 1_000, 4: 100, 5: 10, 6: 1 };
export const GENESIS_DENOMINATION_RF = 1_000_000;
export const GENESIS_ACTIVATION_RF = 100_000;
export const GENESIS_WEIGHT = 2_000_000;
export const TIER_CUMULATIVE_BPS = [10_000, 15_000, 22_500, 33_750, 50_625] as const;
export const GENERATION_WEIGHT_BPS = [0, 17_500, 16_000, 14_500, 13_000, 12_000, 11_000] as const;
export const BURN_SHARE = 0.5;
export const STREAM_SECONDS = 7 * 24 * 3600;
