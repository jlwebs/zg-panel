import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Dashboard from './Dashboard';
import * as requestModule from '../utils/request';

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, fallback?: string) => fallback || key,
    }),
}));

vi.mock('../utils/request', () => ({
    request: vi.fn(),
}));

vi.mock('../components/common/ToastContainer', () => ({
    showToast: vi.fn(),
}));

describe('Dashboard Component', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should fetch and display docker status and quota on mount', async () => {
        const mockQuota = {
            models: [
                {
                    label: 'Gemini 3 Flash',
                    model_id: 'MODEL_PLACEHOLDER_M18',
                    remaining_fraction: 1.0,
                    remaining_pct: 100,
                    reset_in_human: '3h 50m',
                    reset_time: '2026-02-21T18:04:55Z'
                }
            ],
            plan: { plan_name: 'Pro Tier' }
        };

        (requestModule.request as any).mockImplementation((cmd: string, args: any) => {
            if (cmd === 'check_docker') return Promise.resolve('Running');
            if (cmd === 'api_get' && args.path === '/v1/quota') return Promise.resolve(JSON.stringify(mockQuota));
            return Promise.resolve();
        });

        render(<Dashboard />);

        await waitFor(() => {
            expect(requestModule.request).toHaveBeenCalledWith('check_docker');
            expect(requestModule.request).toHaveBeenCalledWith('api_get', { path: '/v1/quota' });
        });

        await waitFor(() => {
            expect(screen.getByText('Running')).toBeInTheDocument();
            expect(screen.getByText('Gemini 3 Flash')).toBeInTheDocument();
        });
    });

    it('should handle docker action', async () => {
        (requestModule.request as any).mockImplementation((cmd: string) => {
            if (cmd === 'check_docker') return Promise.resolve('Running');
            if (cmd === 'api_get') return Promise.resolve(JSON.stringify({ models: [] }));
            if (cmd === 'docker_action') return Promise.resolve();
            return Promise.resolve();
        });

        render(<Dashboard />);

        const killBtn = await screen.findByRole('button', { name: /KILL/i });
        fireEvent.click(killBtn);

        await waitFor(() => {
            expect(requestModule.request).toHaveBeenCalledWith('docker_action', { action: 'stop' });
        });
    });
});
