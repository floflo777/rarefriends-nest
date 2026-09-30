/**
 * Decoded ActivationManager event signatures (topic0), verified on Robinhood Chain on 2026-09-30.
 * `Hardwired` drives the census (hardwired.ts). The other three are not needed for burn attribution
 * (the RF `Transfer` to 0x0 plus the calldata selector already give amount, household and action) but are
 * the right hooks for a receipt-based classification of transactions whose selector is unknown
 * (smart-wallet or multicall wrappers): a receipt containing `Promoted` is a promote, `Claimed` a claim.
 */
export const ACTIVATION_MANAGER_TOPICS = {
  /** Hardwired(address indexed holder, uint256 indexed tokenId, uint8 generation) */
  Hardwired: "0x875780ca58ef9db73990dc0197e3045f3e65f31d7db4e3e0978f1b13faf58792",
  /** Claimed(address,address,uint256,address,uint256) */
  Claimed: "0x240ce5314564d91727709af90e37c14263bd65a1657bf6504f39bc491a4bd9fc",
  /** Promoted(uint256,uint8,uint256) */
  Promoted: "0xf9f5edd116a4231169d7148c628c7b20dbac59d5d20766ac3ee7c08fb8e5f3f3",
  /** Funded(address,address,uint256) */
  Funded: "0x3b5083eec1a1116c56de5d6841cff8efc6a0aec9850e836ec509d6ce024ea561",
} as const;

/** ERC-20 Transfer(address indexed from, address indexed to, uint256 value) */
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
