use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("DmSc562EUuh9yvu2AmEupLLC8wQrXZGVSCZL61EpugvZ");

// ─── Constants ───────────────────────────────────────────────────────────────

pub const QUEST_SEED: &[u8] = b"quest";
pub const VAULT_SEED: &[u8] = b"vault";
pub const VERSION: u8 = 1;

// ─── Program ─────────────────────────────────────────────────────────────────

#[program]
pub mod proof_quest {
    use super::*;

    /// Creator creates a quest account and funds the SPL token vault in one tx.
    pub fn create_and_fund_quest(
        ctx: Context<CreateAndFundQuest>,
        quest_id: u64,
        reward_amount: u64,
        claim_deadline: i64,
        submit_deadline: i64,
        coarse_geohash: [u8; 6],
        evidence_schema_hash: [u8; 32],
    ) -> Result<()> {
        require!(reward_amount > 0, QuestError::ZeroReward);
        require!(claim_deadline > Clock::get()?.unix_timestamp, QuestError::DeadlineInPast);
        require!(submit_deadline > claim_deadline, QuestError::BadDeadlineOrder);

        let creator_key = ctx.accounts.creator.key();
        let mint_key = ctx.accounts.mint.key();
        let quest_key = ctx.accounts.quest.key();

        {
            let quest = &mut ctx.accounts.quest;
            quest.version = VERSION;
            quest.creator = creator_key;
            quest.worker = None;
            quest.mint = mint_key;
            quest.reward_amount = reward_amount;
            quest.status = QuestStatus::Open;
            quest.created_at = Clock::get()?.unix_timestamp;
            quest.claim_deadline = claim_deadline;
            quest.submit_deadline = submit_deadline;
            quest.coarse_geohash = coarse_geohash;
            quest.evidence_schema_hash = evidence_schema_hash;
            quest.evidence_manifest_hash = [0u8; 32];
            quest.submitted_at = None;
            quest.quest_id = quest_id;
            quest.bump = ctx.bumps.quest;
            quest.vault_bump = ctx.bumps.vault;
        }

        // Fund vault
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator_token_account.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            reward_amount,
        )?;

        emit!(QuestCreated {
            quest: quest_key,
            creator: creator_key,
            reward_amount,
            claim_deadline,
            submit_deadline,
        });

        Ok(())
    }

    /// Worker claims an open quest, locking it to their wallet.
    pub fn claim_quest(ctx: Context<ClaimQuest>) -> Result<()> {
        let quest = &mut ctx.accounts.quest;
        require!(quest.status == QuestStatus::Open, QuestError::NotOpen);
        require!(
            Clock::get()?.unix_timestamp < quest.claim_deadline,
            QuestError::ClaimExpired
        );
        require!(
            ctx.accounts.worker.key() != quest.creator,
            QuestError::CreatorCannotClaim
        );

        quest.worker = Some(ctx.accounts.worker.key());
        quest.status = QuestStatus::Claimed;

        emit!(QuestClaimed {
            quest: ctx.accounts.quest.key(),
            worker: ctx.accounts.worker.key(),
        });

        Ok(())
    }

    /// Worker submits the 32-byte SHA-256 manifest digest on-chain.
    pub fn submit_evidence_hash(
        ctx: Context<SubmitEvidenceHash>,
        manifest_hash: [u8; 32],
    ) -> Result<()> {
        let quest = &mut ctx.accounts.quest;
        require!(quest.status == QuestStatus::Claimed, QuestError::NotClaimed);
        require!(
            quest.worker == Some(ctx.accounts.worker.key()),
            QuestError::NotWorker
        );
        require!(
            Clock::get()?.unix_timestamp < quest.submit_deadline,
            QuestError::SubmitExpired
        );
        // Prevent duplicate submission
        require!(
            quest.evidence_manifest_hash == [0u8; 32],
            QuestError::AlreadySubmitted
        );

        quest.evidence_manifest_hash = manifest_hash;
        quest.submitted_at = Some(Clock::get()?.unix_timestamp);
        quest.status = QuestStatus::Submitted;

        emit!(EvidenceSubmitted {
            quest: ctx.accounts.quest.key(),
            worker: ctx.accounts.worker.key(),
            manifest_hash,
        });

        Ok(())
    }

    /// Creator approves the evidence and releases the reward to the worker.
    pub fn approve_and_release(ctx: Context<ApproveAndRelease>) -> Result<()> {
        let (reward, creator, quest_id, bump, worker_key, quest_key) = {
            let quest = &ctx.accounts.quest;
            require!(quest.status == QuestStatus::Submitted, QuestError::NotSubmitted);
            require!(
                ctx.accounts.creator.key() == quest.creator,
                QuestError::NotCreator
            );
            (
                quest.reward_amount,
                quest.creator,
                quest.quest_id,
                quest.vault_bump,
                quest.worker.unwrap(),
                ctx.accounts.quest.key(),
            )
        };

        let seeds: &[&[u8]] = &[VAULT_SEED, creator.as_ref(), &quest_id.to_le_bytes(), &[bump]];
        let signer = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.worker_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer,
            ),
            reward,
        )?;

        ctx.accounts.quest.status = QuestStatus::Approved;

        emit!(QuestApproved {
            quest: quest_key,
            worker: worker_key,
            reward_amount: reward,
        });

        Ok(())
    }

    /// Creator cancels an open (unclaimed) quest and recovers the vault funds.
    pub fn cancel_unclaimed(ctx: Context<CancelUnclaimed>) -> Result<()> {
        let quest = &ctx.accounts.quest;
        require!(quest.status == QuestStatus::Open, QuestError::NotOpen);
        require!(
            ctx.accounts.creator.key() == quest.creator,
            QuestError::NotCreator
        );

        let reward = quest.reward_amount;
        let creator = quest.creator;
        let quest_id = quest.quest_id;
        let bump = quest.vault_bump;

        let seeds: &[&[u8]] = &[VAULT_SEED, creator.as_ref(), &quest_id.to_le_bytes(), &[bump]];
        let signer = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer,
            ),
            reward,
        )?;

        ctx.accounts.quest.status = QuestStatus::Cancelled;

        Ok(())
    }

    /// Anyone can trigger a refund after submit_deadline passes without approval.
    pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
        let quest = &ctx.accounts.quest;
        let now = Clock::get()?.unix_timestamp;

        // Refundable if: claimed but not submitted past submit_deadline,
        // or submitted but not approved past submit_deadline + grace (7 days).
        let refundable = match quest.status {
            QuestStatus::Claimed => now > quest.submit_deadline,
            QuestStatus::Submitted => now > quest.submit_deadline + 7 * 24 * 3600,
            QuestStatus::Open => now > quest.claim_deadline,
            _ => false,
        };
        require!(refundable, QuestError::NotExpired);

        let reward = quest.reward_amount;
        let creator = quest.creator;
        let quest_id = quest.quest_id;
        let bump = quest.vault_bump;

        let seeds: &[&[u8]] = &[VAULT_SEED, creator.as_ref(), &quest_id.to_le_bytes(), &[bump]];
        let signer = &[seeds];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.creator_token_account.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer,
            ),
            reward,
        )?;

        ctx.accounts.quest.status = QuestStatus::Refunded;

        Ok(())
    }
}

// ─── State ───────────────────────────────────────────────────────────────────

#[account]
pub struct Quest {
    pub version: u8,
    pub quest_id: u64,
    pub creator: Pubkey,
    pub worker: Option<Pubkey>,
    pub mint: Pubkey,
    pub reward_amount: u64,
    pub status: QuestStatus,
    pub created_at: i64,
    pub claim_deadline: i64,
    pub submit_deadline: i64,
    pub coarse_geohash: [u8; 6],
    pub evidence_schema_hash: [u8; 32],
    pub evidence_manifest_hash: [u8; 32],
    pub submitted_at: Option<i64>,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Quest {
    // 8 discriminator + fields
    pub const LEN: usize = 8
        + 1   // version
        + 8   // quest_id
        + 32  // creator
        + 1 + 32 // worker (Option<Pubkey>)
        + 32  // mint
        + 8   // reward_amount
        + 1   // status
        + 8   // created_at
        + 8   // claim_deadline
        + 8   // submit_deadline
        + 6   // coarse_geohash
        + 32  // evidence_schema_hash
        + 32  // evidence_manifest_hash
        + 1 + 8 // submitted_at (Option<i64>)
        + 1   // bump
        + 1;  // vault_bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum QuestStatus {
    Open,
    Claimed,
    Submitted,
    Approved,
    Cancelled,
    Refunded,
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(quest_id: u64)]
pub struct CreateAndFundQuest<'info> {
    #[account(
        init,
        payer = creator,
        space = Quest::LEN,
        seeds = [QUEST_SEED, creator.key().as_ref(), &quest_id.to_le_bytes()],
        bump
    )]
    pub quest: Account<'info, Quest>,

    #[account(
        init,
        payer = creator,
        token::mint = mint,
        token::authority = vault,
        seeds = [VAULT_SEED, creator.key().as_ref(), &quest_id.to_le_bytes()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub mint: Account<'info, anchor_spl::token::Mint>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct ClaimQuest<'info> {
    #[account(
        mut,
        seeds = [QUEST_SEED, quest.creator.as_ref(), &quest.quest_id.to_le_bytes()],
        bump = quest.bump
    )]
    pub quest: Account<'info, Quest>,

    pub worker: Signer<'info>,
}

#[derive(Accounts)]
pub struct SubmitEvidenceHash<'info> {
    #[account(
        mut,
        seeds = [QUEST_SEED, quest.creator.as_ref(), &quest.quest_id.to_le_bytes()],
        bump = quest.bump
    )]
    pub quest: Account<'info, Quest>,

    pub worker: Signer<'info>,
}

#[derive(Accounts)]
pub struct ApproveAndRelease<'info> {
    #[account(
        mut,
        seeds = [QUEST_SEED, quest.creator.as_ref(), &quest.quest_id.to_le_bytes()],
        bump = quest.bump
    )]
    pub quest: Account<'info, Quest>,

    #[account(
        mut,
        seeds = [VAULT_SEED, quest.creator.as_ref(), &quest.quest_id.to_le_bytes()],
        bump = quest.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub worker_token_account: Account<'info, TokenAccount>,

    pub creator: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CancelUnclaimed<'info> {
    #[account(
        mut,
        seeds = [QUEST_SEED, quest.creator.as_ref(), &quest.quest_id.to_le_bytes()],
        bump = quest.bump
    )]
    pub quest: Account<'info, Quest>,

    #[account(
        mut,
        seeds = [VAULT_SEED, quest.creator.as_ref(), &quest.quest_id.to_le_bytes()],
        bump = quest.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub creator: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RefundExpired<'info> {
    #[account(
        mut,
        seeds = [QUEST_SEED, quest.creator.as_ref(), &quest.quest_id.to_le_bytes()],
        bump = quest.bump
    )]
    pub quest: Account<'info, Quest>,

    #[account(
        mut,
        seeds = [VAULT_SEED, quest.creator.as_ref(), &quest.quest_id.to_le_bytes()],
        bump = quest.vault_bump
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct QuestCreated {
    pub quest: Pubkey,
    pub creator: Pubkey,
    pub reward_amount: u64,
    pub claim_deadline: i64,
    pub submit_deadline: i64,
}

#[event]
pub struct QuestClaimed {
    pub quest: Pubkey,
    pub worker: Pubkey,
}

#[event]
pub struct EvidenceSubmitted {
    pub quest: Pubkey,
    pub worker: Pubkey,
    pub manifest_hash: [u8; 32],
}

#[event]
pub struct QuestApproved {
    pub quest: Pubkey,
    pub worker: Pubkey,
    pub reward_amount: u64,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum QuestError {
    #[msg("Reward must be greater than zero")]
    ZeroReward,
    #[msg("Deadline must be in the future")]
    DeadlineInPast,
    #[msg("Submit deadline must be after claim deadline")]
    BadDeadlineOrder,
    #[msg("Quest is not open")]
    NotOpen,
    #[msg("Claim deadline has passed")]
    ClaimExpired,
    #[msg("Creator cannot claim their own quest")]
    CreatorCannotClaim,
    #[msg("Quest is not in Claimed state")]
    NotClaimed,
    #[msg("Signer is not the assigned worker")]
    NotWorker,
    #[msg("Submit deadline has passed")]
    SubmitExpired,
    #[msg("Evidence already submitted")]
    AlreadySubmitted,
    #[msg("Quest is not in Submitted state")]
    NotSubmitted,
    #[msg("Signer is not the quest creator")]
    NotCreator,
    #[msg("Quest has not expired yet")]
    NotExpired,
}
