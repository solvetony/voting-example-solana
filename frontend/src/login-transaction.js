import { address, appendTransactionMessageInstructions, blockhash, compileTransaction, createTransactionMessage, getTransactionDecoder, getTransactionEncoder, pipe, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash } from '@solana/kit'
import { getAddMemoInstruction } from '@solana-program/memo'

export function loginTransaction (message, investor) {
  // Privy's fixed expired blockhash keeps authentication transactions off chain.
  const transaction = pipe(
    createTransactionMessage({ version: 'legacy' }),
    value => setTransactionMessageFeePayer(address(investor), value),
    value => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash('GfVcyD5fWFJ6hRm8bsy7CoVPsLSoJhtJKRJYk8T2VVFN'), lastValidBlockHeight: 0n }, value),
    value => appendTransactionMessageInstructions([getAddMemoInstruction({ memo: message })], value),
    compileTransaction
  )
  return new Uint8Array(getTransactionEncoder().encode(transaction))
}

export function loginSignature (signedTransaction, investor) {
  const signature = getTransactionDecoder().decode(signedTransaction).signatures[investor]
  if (!signature) throw new Error('Wallet did not sign the login transaction')
  return btoa(String.fromCharCode(...signature))
}
