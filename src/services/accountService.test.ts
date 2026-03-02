import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as accountService from './accountService';
import * as requestModule from '../utils/request';

// Mock the request invoke function
vi.mock('../utils/request', () => {
    return {
        request: vi.fn(),
    };
});

describe('accountService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('listAccounts', () => {
        it('should return mapped array of accounts with quota', async () => {
            // Mock the first call to /v1/accounts
            const mockAccountsResponse = JSON.stringify({
                accounts: [
                    { email: 'user1@test.com', active: true },
                    { email: 'user2@test.com', active: false }
                ]
            });

            // Mock the second and third calls to /v1/quota
            const mockQuota1 = JSON.stringify({
                plan: { tier_name: 'Pro', plan_name: 'Pro' },
                models: [
                    { model_id: 'MODEL_PLACEHOLDER_M26', remaining_pct: 100, reset_time: '2026-02-21T19:08:38Z', label: 'Claude Opus (Thinking)' }
                ]
            });

            const mockQuota2 = JSON.stringify({
                plan: { tier_name: 'Free', plan_name: 'Free' },
                models: [
                    { model_id: 'MODEL_PLACEHOLDER_M18', remaining_pct: 50, reset_time: '2026-02-21T19:08:38Z', label: 'Gemini Flash' }
                ]
            });

            // Set up mock resolution based on path
            (requestModule.request as any).mockImplementation((_cmd: string, args: any) => {
                if (args.path === '/v1/accounts') return Promise.resolve(mockAccountsResponse);
                if (args.path.includes('user1')) return Promise.resolve(mockQuota1);
                if (args.path.includes('user2')) return Promise.resolve(mockQuota2);
                return Promise.resolve("{}");
            });

            const accounts = await accountService.listAccounts();

            expect(accounts).toHaveLength(2);
            expect(accounts[0].id).toBe('user1@test.com');
            expect(accounts[0].quota.subscription_tier).toBe('Pro');
            expect(accounts[0].quota.models[0].name).toBe('claude-opus-4-6-thinking');
            expect(accounts[0].quota.models[0].percentage).toBe(100);

            expect(accounts[1].id).toBe('user2@test.com');
            expect(accounts[1].quota.subscription_tier).toBe('Free');
            expect(accounts[1].quota.models[0].name).toBe('gemini-3-flash');
            expect(accounts[1].quota.models[0].percentage).toBe(50);
        });

        it('should return empty array if no accounts', async () => {
            (requestModule.request as any).mockResolvedValue(JSON.stringify({ accounts: [] }));
            const accounts = await accountService.listAccounts();
            expect(accounts).toEqual([]);
        });
    });

    describe('addAccount', () => {
        it('should send post payload', async () => {
            (requestModule.request as any).mockResolvedValue(JSON.stringify({ status: "ok" }));
            const result = await accountService.addAccount('new@test.com', 'token123');

            expect(requestModule.request).toHaveBeenCalledWith('api_post', {
                path: '/v1/accounts',
                bodyJson: JSON.stringify({ email: 'new@test.com', refresh_token: 'token123' })
            });
            expect(result).toEqual({ status: "ok" });
        });
    });

    describe('deleteAccount', () => {
        it('should send delete payload', async () => {
            (requestModule.request as any).mockResolvedValue(JSON.stringify({ status: "removed" }));
            await accountService.deleteAccount('old@test.com');

            expect(requestModule.request).toHaveBeenCalledWith('api_delete', {
                path: '/v1/accounts',
                bodyJson: JSON.stringify({ email: 'old@test.com' })
            });
        });
    });
});
