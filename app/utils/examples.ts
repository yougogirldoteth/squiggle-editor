import type { SquiggleType } from './squiggle'

/** Collection examples verified against token.artblocks.io on 2026-09-25. */
export const TYPE_EXAMPLES = {
  Normal: { tokenId: 0, hash: '0x722899b10c66da3b72fb60a8e71df442ee1c004547ba2227d76bed357469b4ea' },
  Bold: { tokenId: 20, hash: '0xd899e79f25e989ed51fe27c0db473e1fadcae13fb7543b0586f2a6cf5284f7f5' },
  Slinky: { tokenId: 5, hash: '0x7eff1723ccf67ef9d2aa3156980f57f03b73a8b19721b52db3c74b60a26a2e1f' },
  Ribbed: { tokenId: 10, hash: '0x86278fc72cd40995d59932bdd470626d14d3522edf2dd0191d186b815587fc3e' },
  Pipe: { tokenId: 74, hash: '0x99c16472173f7bc710f371d81cced716f9f9aeec5d791ce3aef24ca81eeba61a' },
  Fuzzy: { tokenId: 7, hash: '0x3c17af010c7af574f5dab0f449e3e360212d9bc9521e16709aff20a8b0fb44ba' },
} as const satisfies Record<SquiggleType, { tokenId: number, hash: string }>
