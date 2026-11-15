import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideAnalysis, canRequestAnalysis } from '../src/domain/session.policy.ts';

const base = { kind: 'audio' as const, durationSec: 120, isPlacement: false, maxAnalyzeSec: 300, remainingCredits: 3 };

test('bài ngắn, còn lượt → phân tích', () => assert.deepEqual(decideAnalysis(base), { action: 'enqueue' }));
test('đúng 5:00 vẫn phân tích', () => assert.equal(decideAnalysis({ ...base, durationSec: 300 }).action, 'enqueue'));
test('5:01 với gói Miễn phí → chờ Premium', () => assert.deepEqual(decideAnalysis({ ...base, durationSec: 301 }), { action: 'block', status: 'pending_premium', reason: 'over_free_duration' }));
test('quá 5 phút được ưu tiên báo trước hết lượt', () => assert.equal(decideAnalysis({ ...base, durationSec: 400, remainingCredits: 0 }).action === 'block' && (decideAnalysis({ ...base, durationSec: 400, remainingCredits: 0 }) as { status: string }).status, 'pending_premium'));
test('Premium 20 phút → phân tích', () => assert.equal(decideAnalysis({ ...base, durationSec: 1200, maxAnalyzeSec: 1800 }).action, 'enqueue'));
test('kịch bản không áp quy tắc thời lượng', () => assert.equal(decideAnalysis({ ...base, kind: 'script', durationSec: 999 }).action, 'enqueue'));
test('hết lượt → chờ lượt', () => assert.deepEqual(decideAnalysis({ ...base, remainingCredits: 0 }), { action: 'block', status: 'pending_quota', reason: 'no_quota' }));
test('bài test đầu vào không tính lượt', () => assert.equal(decideAnalysis({ ...base, isPlacement: true, remainingCredits: 0 }).action, 'enqueue'));
test('chạy lại được từ trạng thái chờ hoặc lỗi, không được khi đang xử lý', () => {
  assert.ok(canRequestAnalysis('pending_premium') && canRequestAnalysis('failed') && canRequestAnalysis('pending_quota'));
  assert.ok(!canRequestAnalysis('processing') && !canRequestAnalysis('completed') && !canRequestAnalysis('uploading'));
});
