use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{self, Burn, Mint, TokenAccount, TransferChecked};
use solana_sha256_hasher::hashv;

declare_id!("887VzhmU4fYt5xgkks5F83eNmjsSFwyVMaTHm72Lmdis");

#[program]
pub mod kase_bond {
    use super::*;

    pub fn initialize_bond(
        ctx: Context<InitializeBond>,
        face_value: u64,
        coupon_bps: u16,
        frequency: u16,
        maturity: i64,
        outstanding: u64,
    ) -> Result<()> {
        require!(
            face_value > 0
                && frequency > 0
                && coupon_bps > 0
                && coupon_bps <= 10_000
                && outstanding > 0,
            BondError::Parameters
        );
        require!(maturity > Clock::get()?.unix_timestamp, BondError::TooEarly);
        require!(
            ctx.accounts.bond_mint.decimals == 0 && ctx.accounts.settlement_mint.decimals == 6,
            BondError::Mint
        );
        require!(
            ctx.accounts.bond_mint.key() != ctx.accounts.settlement_mint.key(),
            BondError::Mint
        );
        require!(
            ctx.accounts.bond_mint.freeze_authority.is_none()
                && ctx.accounts.settlement_mint.freeze_authority.is_none(),
            BondError::Mint
        );
        require!(
            ctx.accounts.bond_mint.to_account_info().data_len() == 82
                && ctx.accounts.settlement_mint.to_account_info().data_len() == 82,
            BondError::Mint
        );
        require!(
            ctx.accounts.bond_mint.mint_authority
                == anchor_lang::solana_program::program_option::COption::Some(
                    ctx.accounts.issuer.key()
                ),
            BondError::Unauthorized
        );
        require!(
            (face_value as u128 * coupon_bps as u128) % (10_000u128 * frequency as u128) == 0,
            BondError::Parameters
        );
        let bond = &mut ctx.accounts.bond;
        bond.issuer = ctx.accounts.issuer.key();
        bond.bond_mint = ctx.accounts.bond_mint.key();
        bond.settlement_mint = ctx.accounts.settlement_mint.key();
        bond.face_value = face_value;
        bond.coupon_bps = coupon_bps;
        bond.frequency = frequency;
        bond.maturity = maturity;
        bond.outstanding = outstanding;
        bond.bump = ctx.bumps.bond;
        principal(outstanding, face_value)?;
        coupon(outstanding, bond)?;
        Ok(())
    }

    pub fn initialize_coupon_action(
        ctx: Context<InitializeCoupon>,
        action_id: [u8; 32],
        record_slot: u64,
    ) -> Result<()> {
        require!(
            record_slot > 0 && record_slot <= Clock::get()?.slot,
            BondError::Parameters
        );
        let action = &mut ctx.accounts.action;
        action.bond = ctx.accounts.bond.key();
        action.action_id = action_id;
        action.record_slot = record_slot;
        action.bump = ctx.bumps.action;
        Ok(())
    }

    pub fn finalize_coupon_snapshot(
        ctx: Context<FinalizeCoupon>,
        root: [u8; 32],
        manifest_hash: [u8; 32],
        quantity: u64,
        liability: u64,
    ) -> Result<()> {
        let action = &mut ctx.accounts.action;
        require!(!action.finalized, BondError::Finalized);
        require!(
            root != [0; 32] && manifest_hash != [0; 32],
            BondError::Parameters
        );
        require!(
            ctx.accounts.bond_mint.mint_authority.is_none(),
            BondError::IssuanceOpen
        );
        require!(
            quantity == ctx.accounts.bond.outstanding && ctx.accounts.bond_mint.supply == quantity,
            BondError::Reconciliation
        );
        require!(
            liability == coupon(quantity, &ctx.accounts.bond)?,
            BondError::Amount
        );
        require!(ctx.accounts.vault.amount >= liability, BondError::Funding);
        action.root = root;
        action.manifest_hash = manifest_hash;
        action.quantity = quantity;
        action.liability = liability;
        action.finalized = true;
        Ok(())
    }

    pub fn claim_coupon(
        ctx: Context<ClaimCoupon>,
        quantity: u64,
        entitlement: u64,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        let action = &ctx.accounts.action;
        require!(action.finalized, BondError::NotFinalized);
        require!(
            quantity > 0 && entitlement == coupon(quantity, &ctx.accounts.bond)?,
            BondError::Amount
        );
        require!(proof.len() <= 32, BondError::Proof);
        let leaf = coupon_leaf(
            &ctx.accounts.bond.bond_mint,
            &action.action_id,
            &ctx.accounts.investor.key(),
            quantity,
            entitlement,
        );
        require!(verify_proof(leaf, &proof, action.root), BondError::Proof);
        let settled = action
            .settled
            .checked_add(entitlement)
            .ok_or(BondError::Overflow)?;
        require!(settled <= action.liability, BondError::Amount);
        let bond_key = ctx.accounts.bond.key();
        let bump = [action.bump];
        let seeds: &[&[u8]] = &[b"coupon", bond_key.as_ref(), &action.action_id, &bump];
        transfer(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.destination,
            &ctx.accounts.settlement_mint,
            action.to_account_info(),
            &[seeds],
            entitlement,
        )?;
        let claim = &mut ctx.accounts.claim;
        claim.action = action.key();
        claim.investor = ctx.accounts.investor.key();
        claim.amount = entitlement;
        ctx.accounts.action.settled = settled;
        emit!(CouponPaid {
            action: ctx.accounts.action.key(),
            investor: ctx.accounts.investor.key(),
            amount: entitlement
        });
        Ok(())
    }

    pub fn initialize_redemption(ctx: Context<InitializeRedemption>, cutoff: i64) -> Result<()> {
        require!(
            cutoff > Clock::get()?.unix_timestamp && cutoff <= ctx.accounts.bond.maturity,
            BondError::Parameters
        );
        let state = &mut ctx.accounts.redemption;
        state.bond = ctx.accounts.bond.key();
        state.cutoff = cutoff;
        state.bump = ctx.bumps.redemption;
        Ok(())
    }

    pub fn deposit_for_redemption(ctx: Context<Deposit>, quantity: u64) -> Result<()> {
        let state = &mut ctx.accounts.redemption;
        require!(
            !state.finalized && Clock::get()?.unix_timestamp < state.cutoff,
            BondError::DepositsClosed
        );
        require!(quantity > 0, BondError::Amount);
        let total = state
            .locked
            .checked_add(quantity)
            .ok_or(BondError::Overflow)?;
        require!(total <= ctx.accounts.bond.outstanding, BondError::Amount);
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.source.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    mint: ctx.accounts.bond_mint.to_account_info(),
                    authority: ctx.accounts.investor.to_account_info(),
                },
            ),
            quantity,
            0,
        )?;
        let position = &mut ctx.accounts.position;
        if position.investor == Pubkey::default() {
            position.bond = ctx.accounts.bond.key();
            position.investor = ctx.accounts.investor.key();
        }
        require!(
            position.investor == ctx.accounts.investor.key()
                && position.bond == ctx.accounts.bond.key(),
            BondError::Unauthorized
        );
        position.locked = position
            .locked
            .checked_add(quantity)
            .ok_or(BondError::Overflow)?;
        position.deposited_at = Clock::get()?.unix_timestamp;
        state.locked = total;
        Ok(())
    }

    pub fn finalize_redemption(ctx: Context<FinalizeRedemption>) -> Result<()> {
        let state = &mut ctx.accounts.redemption;
        require!(!state.finalized, BondError::Finalized);
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= state.cutoff && now >= ctx.accounts.bond.maturity,
            BondError::TooEarly
        );
        require!(
            ctx.accounts.bond_mint.mint_authority.is_none(),
            BondError::IssuanceOpen
        );
        require!(
            state.locked > 0
                && state.locked <= ctx.accounts.bond.outstanding
                && ctx.accounts.escrow.amount == state.locked,
            BondError::Reconciliation
        );
        require!(
            ctx.accounts.bond_mint.supply == ctx.accounts.bond.outstanding,
            BondError::Reconciliation
        );
        let liability = principal(state.locked, ctx.accounts.bond.face_value)?;
        require!(ctx.accounts.vault.amount >= liability, BondError::Funding);
        state.liability = liability;
        state.finalized = true;
        Ok(())
    }

    pub fn redeem_bonds(ctx: Context<Redeem>) -> Result<()> {
        let state = &mut ctx.accounts.redemption;
        require!(state.finalized, BondError::NotFinalized);
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.bond.maturity,
            BondError::TooEarly
        );
        let position = &mut ctx.accounts.position;
        let quantity = position
            .locked
            .checked_sub(position.redeemed)
            .ok_or(BondError::Reconciliation)?;
        require!(quantity > 0, BondError::AlreadyRedeemed);
        let amount = principal(quantity, ctx.accounts.bond.face_value)?;
        let total_redeemed = state
            .redeemed
            .checked_add(quantity)
            .ok_or(BondError::Overflow)?;
        let settled = state
            .settled
            .checked_add(amount)
            .ok_or(BondError::Overflow)?;
        require!(
            total_redeemed <= state.locked && settled <= state.liability,
            BondError::Amount
        );
        require!(ctx.accounts.vault.amount >= amount, BondError::Funding);
        let bond_key = ctx.accounts.bond.key();
        let bump = [state.bump];
        let seeds: &[&[u8]] = &[b"redemption", bond_key.as_ref(), &bump];
        token_interface::burn(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.bond_mint.to_account_info(),
                    from: ctx.accounts.escrow.to_account_info(),
                    authority: state.to_account_info(),
                },
                &[seeds],
            ),
            quantity,
        )?;
        transfer(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.destination,
            &ctx.accounts.settlement_mint,
            state.to_account_info(),
            &[seeds],
            amount,
        )?;
        position.redeemed = position.locked;
        state.redeemed = total_redeemed;
        state.settled = settled;
        emit!(PrincipalPaid {
            bond: bond_key,
            investor: ctx.accounts.investor.key(),
            quantity,
            amount
        });
        Ok(())
    }

    pub fn record_vote_result(
        ctx: Context<RecordVote>,
        proposal: [u8; 32],
        record_slot: u64,
        voting_end: i64,
        result_hash: [u8; 32],
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        require!(
            record_slot > 0
                && record_slot <= Clock::get()?.slot
                && voting_end <= Clock::get()?.unix_timestamp,
            BondError::TooEarly
        );
        require!(
            proposal != [0; 32] && result_hash != [0; 32] && evidence_hash != [0; 32],
            BondError::Parameters
        );
        let result = &mut ctx.accounts.result;
        result.bond = ctx.accounts.bond.key();
        result.proposal = proposal;
        result.record_slot = record_slot;
        result.voting_end = voting_end;
        result.result_hash = result_hash;
        result.evidence_hash = evidence_hash;
        Ok(())
    }
}

pub fn principal(quantity: u64, face: u64) -> Result<u64> {
    u64::try_from(
        (quantity as u128)
            .checked_mul(face as u128)
            .ok_or(BondError::Overflow)?,
    )
    .map_err(|_| error!(BondError::Overflow))
}

pub fn coupon(quantity: u64, bond: &BondConfig) -> Result<u64> {
    let numerator = (quantity as u128)
        .checked_mul(bond.face_value as u128)
        .and_then(|v| v.checked_mul(bond.coupon_bps as u128))
        .ok_or(BondError::Overflow)?;
    let denominator = 10_000u128
        .checked_mul(bond.frequency as u128)
        .ok_or(BondError::Overflow)?;
    require!(denominator > 0, BondError::Parameters);
    u64::try_from(numerator / denominator).map_err(|_| error!(BondError::Overflow))
}

pub fn coupon_leaf(
    mint: &Pubkey,
    action: &[u8; 32],
    investor: &Pubkey,
    quantity: u64,
    entitlement: u64,
) -> [u8; 32] {
    hashv(&[
        b"KASE_COUPON_V1",
        mint.as_ref(),
        action,
        investor.as_ref(),
        &quantity.to_le_bytes(),
        &entitlement.to_le_bytes(),
    ])
    .to_bytes()
}

pub fn verify_proof(mut leaf: [u8; 32], proof: &[[u8; 32]], root: [u8; 32]) -> bool {
    for sibling in proof {
        let (left, right) = if leaf <= *sibling {
            (leaf, *sibling)
        } else {
            (*sibling, leaf)
        };
        leaf = hashv(&[&[1u8][..], &left[..], &right[..]]).to_bytes();
    }
    leaf == root
}

fn transfer<'info>(
    program: &Program<'info, Token2022>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: AccountInfo<'info>,
    seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(),
                to: to.to_account_info(),
                mint: mint.to_account_info(),
                authority,
            },
            seeds,
        ),
        amount,
        6,
    )
}

#[derive(Accounts)]
pub struct InitializeBond<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(init, payer = issuer, space = 8 + BondConfig::INIT_SPACE, seeds = [b"bond", bond_mint.key().as_ref()], bump)]
    pub bond: Account<'info, BondConfig>,
    #[account(mint::token_program = token_program)]
    pub bond_mint: InterfaceAccount<'info, Mint>,
    #[account(mint::token_program = token_program)]
    pub settlement_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(action_id: [u8; 32])]
pub struct InitializeCoupon<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(seeds = [b"bond", bond.bond_mint.as_ref()], bump = bond.bump, has_one = issuer, has_one = settlement_mint)]
    pub bond: Account<'info, BondConfig>,
    #[account(init, payer = issuer, space = 8 + CorporateAction::INIT_SPACE, seeds = [b"coupon", bond.key().as_ref(), &action_id], bump)]
    pub action: Account<'info, CorporateAction>,
    #[account(init, payer = issuer, seeds = [b"coupon-vault", action.key().as_ref()], bump, token::mint = settlement_mint, token::authority = action, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub settlement_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeCoupon<'info> {
    pub issuer: Signer<'info>,
    #[account(seeds = [b"bond", bond.bond_mint.as_ref()], bump = bond.bump, has_one = issuer, has_one = bond_mint)]
    pub bond: Account<'info, BondConfig>,
    #[account(mut, seeds = [b"coupon", bond.key().as_ref(), &action.action_id], bump = action.bump, has_one = bond)]
    pub action: Account<'info, CorporateAction>,
    #[account(seeds = [b"coupon-vault", action.key().as_ref()], bump, token::mint = bond.settlement_mint, token::authority = action, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub bond_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct ClaimCoupon<'info> {
    #[account(mut)]
    pub investor: Signer<'info>,
    #[account(seeds = [b"bond", bond.bond_mint.as_ref()], bump = bond.bump, has_one = settlement_mint)]
    pub bond: Account<'info, BondConfig>,
    #[account(mut, seeds = [b"coupon", bond.key().as_ref(), &action.action_id], bump = action.bump, has_one = bond)]
    pub action: Account<'info, CorporateAction>,
    #[account(init, payer = investor, space = 8 + CouponClaim::INIT_SPACE, seeds = [b"claim", action.key().as_ref(), investor.key().as_ref()], bump)]
    pub claim: Account<'info, CouponClaim>,
    #[account(mut, seeds = [b"coupon-vault", action.key().as_ref()], bump, token::mint = settlement_mint, token::authority = action, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = settlement_mint, token::authority = investor, token::token_program = token_program)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub settlement_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeRedemption<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(seeds = [b"bond", bond.bond_mint.as_ref()], bump = bond.bump, has_one = issuer, has_one = bond_mint, has_one = settlement_mint)]
    pub bond: Account<'info, BondConfig>,
    #[account(init, payer = issuer, space = 8 + RedemptionState::INIT_SPACE, seeds = [b"redemption", bond.key().as_ref()], bump)]
    pub redemption: Account<'info, RedemptionState>,
    #[account(init, payer = issuer, seeds = [b"escrow", redemption.key().as_ref()], bump, token::mint = bond_mint, token::authority = redemption, token::token_program = token_program)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,
    #[account(init, payer = issuer, seeds = [b"principal-vault", redemption.key().as_ref()], bump, token::mint = settlement_mint, token::authority = redemption, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub bond_mint: InterfaceAccount<'info, Mint>,
    #[account(mint::token_program = token_program)]
    pub settlement_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub investor: Signer<'info>,
    #[account(seeds = [b"bond", bond.bond_mint.as_ref()], bump = bond.bump, has_one = bond_mint)]
    pub bond: Account<'info, BondConfig>,
    #[account(mut, seeds = [b"redemption", bond.key().as_ref()], bump = redemption.bump, has_one = bond)]
    pub redemption: Account<'info, RedemptionState>,
    #[account(init_if_needed, payer = investor, space = 8 + EscrowPosition::INIT_SPACE, seeds = [b"position", bond.key().as_ref(), investor.key().as_ref()], bump)]
    pub position: Account<'info, EscrowPosition>,
    #[account(mut, seeds = [b"escrow", redemption.key().as_ref()], bump, token::mint = bond_mint, token::authority = redemption, token::token_program = token_program)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = bond_mint, token::authority = investor, token::token_program = token_program)]
    pub source: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub bond_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeRedemption<'info> {
    pub issuer: Signer<'info>,
    #[account(seeds = [b"bond", bond.bond_mint.as_ref()], bump = bond.bump, has_one = issuer, has_one = bond_mint)]
    pub bond: Account<'info, BondConfig>,
    #[account(mut, seeds = [b"redemption", bond.key().as_ref()], bump = redemption.bump, has_one = bond)]
    pub redemption: Account<'info, RedemptionState>,
    #[account(seeds = [b"escrow", redemption.key().as_ref()], bump, token::mint = bond_mint, token::authority = redemption, token::token_program = token_program)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,
    #[account(seeds = [b"principal-vault", redemption.key().as_ref()], bump, token::mint = bond.settlement_mint, token::authority = redemption, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mint::token_program = token_program)]
    pub bond_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    pub investor: Signer<'info>,
    #[account(seeds = [b"bond", bond.bond_mint.as_ref()], bump = bond.bump, has_one = bond_mint, has_one = settlement_mint)]
    pub bond: Account<'info, BondConfig>,
    #[account(mut, seeds = [b"redemption", bond.key().as_ref()], bump = redemption.bump, has_one = bond)]
    pub redemption: Account<'info, RedemptionState>,
    #[account(mut, seeds = [b"position", bond.key().as_ref(), investor.key().as_ref()], bump, has_one = bond, has_one = investor)]
    pub position: Account<'info, EscrowPosition>,
    #[account(mut, seeds = [b"escrow", redemption.key().as_ref()], bump, token::mint = bond_mint, token::authority = redemption, token::token_program = token_program)]
    pub escrow: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"principal-vault", redemption.key().as_ref()], bump, token::mint = settlement_mint, token::authority = redemption, token::token_program = token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = settlement_mint, token::authority = investor, token::token_program = token_program)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, mint::token_program = token_program)]
    pub bond_mint: InterfaceAccount<'info, Mint>,
    #[account(mint::token_program = token_program)]
    pub settlement_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
#[instruction(proposal: [u8; 32])]
pub struct RecordVote<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(seeds = [b"bond", bond.bond_mint.as_ref()], bump = bond.bump, has_one = issuer)]
    pub bond: Account<'info, BondConfig>,
    #[account(init, payer = issuer, space = 8 + VoteResultCommitment::INIT_SPACE, seeds = [b"vote", bond.key().as_ref(), &proposal], bump)]
    pub result: Account<'info, VoteResultCommitment>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct BondConfig {
    pub issuer: Pubkey,
    pub bond_mint: Pubkey,
    pub settlement_mint: Pubkey,
    pub face_value: u64,
    pub coupon_bps: u16,
    pub frequency: u16,
    pub maturity: i64,
    pub outstanding: u64,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct CorporateAction {
    pub bond: Pubkey,
    pub action_id: [u8; 32],
    pub record_slot: u64,
    pub root: [u8; 32],
    pub manifest_hash: [u8; 32],
    pub quantity: u64,
    pub liability: u64,
    pub settled: u64,
    pub finalized: bool,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct CouponClaim {
    pub action: Pubkey,
    pub investor: Pubkey,
    pub amount: u64,
}
#[account]
#[derive(InitSpace)]
pub struct RedemptionState {
    pub bond: Pubkey,
    pub cutoff: i64,
    pub locked: u64,
    pub redeemed: u64,
    pub liability: u64,
    pub settled: u64,
    pub finalized: bool,
    pub bump: u8,
}
#[account]
#[derive(InitSpace)]
pub struct EscrowPosition {
    pub bond: Pubkey,
    pub investor: Pubkey,
    pub locked: u64,
    pub redeemed: u64,
    pub deposited_at: i64,
}
#[account]
#[derive(InitSpace)]
pub struct VoteResultCommitment {
    pub bond: Pubkey,
    pub proposal: [u8; 32],
    pub record_slot: u64,
    pub voting_end: i64,
    pub result_hash: [u8; 32],
    pub evidence_hash: [u8; 32],
}
#[event]
pub struct CouponPaid {
    pub action: Pubkey,
    pub investor: Pubkey,
    pub amount: u64,
}
#[event]
pub struct PrincipalPaid {
    pub bond: Pubkey,
    pub investor: Pubkey,
    pub quantity: u64,
    pub amount: u64,
}

#[error_code]
pub enum BondError {
    #[msg("Invalid economic parameters")]
    Parameters,
    #[msg("Unsupported or incorrect mint")]
    Mint,
    #[msg("Issuer or investor authority mismatch")]
    Unauthorized,
    #[msg("Required date has not passed")]
    TooEarly,
    #[msg("Action is already finalized")]
    Finalized,
    #[msg("Action is not finalized")]
    NotFinalized,
    #[msg("Supply or escrow reconciliation failed")]
    Reconciliation,
    #[msg("Incorrect settlement amount")]
    Amount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Invalid Merkle proof")]
    Proof,
    #[msg("Settlement vault is underfunded")]
    Funding,
    #[msg("Bond mint authority must be revoked")]
    IssuanceOpen,
    #[msg("Escrow deposits are closed")]
    DepositsClosed,
    #[msg("Position has already been redeemed")]
    AlreadyRedeemed,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checked_economics_and_merkle_domains() {
        let bond = BondConfig {
            issuer: Pubkey::default(),
            bond_mint: Pubkey::default(),
            settlement_mint: Pubkey::default(),
            face_value: 1_000_000_000,
            coupon_bps: 1000,
            frequency: 2,
            maturity: 1,
            outstanding: 17,
            bump: 0,
        };
        assert_eq!(coupon(10, &bond).unwrap(), 500_000_000);
        assert_eq!(coupon(17, &bond).unwrap(), 850_000_000);
        assert_eq!(principal(17, bond.face_value).unwrap(), 17_000_000_000);
        assert!(principal(u64::MAX, 2).is_err());
        let mint = Pubkey::new_from_array([2; 32]);
        let investor = Pubkey::new_from_array([3; 32]);
        let leaf = coupon_leaf(&mint, &[1; 32], &investor, 10, 500_000_000);
        assert!(verify_proof(leaf, &[], leaf));
        assert!(!verify_proof(
            coupon_leaf(&mint, &[1; 32], &investor, 11, 500_000_000),
            &[],
            leaf
        ));
        assert_eq!(
            leaf,
            [
                0x07, 0xa1, 0x19, 0xd3, 0x5a, 0x96, 0xf6, 0x32, 0xde, 0x2c, 0xac, 0xd4, 0x43, 0x36,
                0x5e, 0xfe, 0xb6, 0x53, 0xd5, 0xe0, 0x67, 0x52, 0x99, 0xf3, 0xc1, 0x52, 0xcf, 0xb1,
                0x4d, 0x7d, 0xa4, 0x83
            ]
        );
    }
}
