import * as http from 'http';

const BASE = 'http://localhost:3000';

function request<T = any>(options: {
  method: string;
  path: string;
  body?: any;
  headers?: Record<string, string>;
}): Promise<{ body: T; headers: Record<string, string | string[]> }> {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + options.path);
    const data = options.body ? JSON.stringify(options.body) : undefined;
    const req = http.request(
      {
        hostname: url.hostname,
        port: parseInt(url.port, 10),
        path: url.pathname + url.search,
        method: options.method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
          ...(options.headers || {}),
        },
      },
      res => {
        let chunks = '';
        res.on('data', c => (chunks += c));
        res.on('end', () => {
          try {
            resolve({ body: JSON.parse(chunks) as T, headers: res.headers as any });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ' - ' + detail : ''}`);
  }
}

async function setupTestFixture(prefix: string, durationThreshold: number) {
  const { body: vehicleRes } = await request<any>({
    method: 'POST',
    path: '/api/vehicles',
    body: {
      plateNumber: `${prefix}-PLATE`,
      deviceId: `${prefix}-DEV`,
      driverName: '测试司机',
      driverPhone: '13900000000',
    },
  });
  const vehicleId = vehicleRes.data.id;
  const { body: waybillRes } = await request<any>({
    method: 'POST',
    path: '/api/waybills',
    body: {
      waybillNo: `${prefix}-YB-${Date.now()}`,
      vehicleId,
      customerId: `${prefix}-CUST`,
      customerName: '测试客户',
      goodsName: '测试冷冻品',
      origin: '起点',
      destination: '终点',
      temperatureZones: [
        {
          zoneName: '冷冻区',
          minTemp: -20,
          maxTemp: -12,
          durationThreshold,
        },
      ],
    },
  });
  return {
    vehicleId,
    waybillId: waybillRes.data.id,
    waybillNo: waybillRes.data.waybillNo,
    zoneId: waybillRes.data.temperatureZones[0].zoneId,
  };
}

async function verifyConsistency(ctx: {
  vehicleId: string;
  waybillId: string;
  waybillNo: string;
  expectedAlertCount: number;
  expectedExceptionCount: number;
  expectedExceptionDuration: number;
  scenario: string;
}) {
  console.log(`  ↓ 一致性校验：${ctx.scenario}`);

  const { body: alertsRes } = await request<any>({
    method: 'GET',
    path: `/api/alerts?waybillId=${ctx.waybillId}`,
  });
  assert(`/api/alerts 对外告警总数 = ${ctx.expectedAlertCount}`,
    alertsRes.data.total === ctx.expectedAlertCount,
    `实际=${alertsRes.data.total}`);

  const { body: activeRes } = await request<any>({
    method: 'GET',
    path: `/api/alerts/vehicle/${ctx.vehicleId}/active`,
  });
  const activeTotal = activeRes.data.pending.length + activeRes.data.processing.length;
  assert(`/api/alerts/vehicle/.../active 未处理告警数 ≤ ${ctx.expectedAlertCount}`,
    activeTotal <= ctx.expectedAlertCount,
    `实际=${activeTotal}`);

  const { body: summaryRes } = await request<any>({
    method: 'GET',
    path: `/api/reports/${ctx.waybillId}/summary`,
  });
  const zoneSummary = summaryRes.data.zones[0];
  assert(`/api/reports/.../summary exceptionCount = ${ctx.expectedExceptionCount}`,
    zoneSummary.exceptionCount === ctx.expectedExceptionCount,
    `实际=${zoneSummary.exceptionCount}`);
  assert(`/api/reports/.../summary exceptionDuration = ${ctx.expectedExceptionDuration}`,
    zoneSummary.exceptionDuration === ctx.expectedExceptionDuration,
    `实际=${zoneSummary.exceptionDuration}`);

  const { body: fullReportRes } = await request<any>({
    method: 'GET',
    path: `/api/reports/${ctx.waybillId}`,
  });
  assert(`/api/reports/... 顶层 exceptionSummary.totalAlerts = ${ctx.expectedAlertCount}`,
    fullReportRes.data.exceptionSummary.totalAlerts === ctx.expectedAlertCount,
    `实际=${fullReportRes.data.exceptionSummary.totalAlerts}`);
  const zoneFull = fullReportRes.data.zones[0];
  assert(`/api/reports/... 温区 exceptionCount = ${ctx.expectedExceptionCount}`,
    zoneFull.exceptionCount === ctx.expectedExceptionCount,
    `实际=${zoneFull.exceptionCount}`);
  assert(`/api/reports/... 温区 exceptionDuration = ${ctx.expectedExceptionDuration}`,
    zoneFull.exceptionDuration === ctx.expectedExceptionDuration,
    `实际=${zoneFull.exceptionDuration}`);
  if (ctx.expectedAlertCount > 0) {
    const firstAlert = fullReportRes.data.alerts[0];
    assert(`/api/reports/... 告警 durationSeconds = ${ctx.expectedExceptionDuration}`,
      firstAlert && firstAlert.durationSeconds === ctx.expectedExceptionDuration,
      `实际=${firstAlert?.durationSeconds}`);
  }

  const { body: receiptRes } = await request<any>({
    method: 'GET',
    path: `/api/receipt/${ctx.waybillId}/stats`,
  });
  assert(`/api/receipt/.../stats totalAlerts = ${ctx.expectedAlertCount}`,
    receiptRes.data.totalAlerts === ctx.expectedAlertCount,
    `实际=${receiptRes.data.totalAlerts}`);
  assert(`/api/receipt/.../stats totalExceptionDurationSec = ${ctx.expectedExceptionDuration}`,
    receiptRes.data.totalExceptionDurationSec === ctx.expectedExceptionDuration,
    `实际=${receiptRes.data.totalExceptionDurationSec}`);
}

async function main() {
  console.log('\n========== 冷链后端边界场景验证用例（v3） ==========\n');

  const THRESHOLD = 60;

  console.log('【场景 A】超温 70 秒才恢复（超过阈值 60s）→ 应生成正式告警，异常时长 70s');
  const ctxA = await setupTestFixture('BOUNDARY-A', THRESHOLD);
  const T_A = Date.now();
  await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: { vehicleId: ctxA.vehicleId, waybillId: ctxA.waybillId, zoneId: ctxA.zoneId, temperature: -5, timestamp: T_A },
  });
  await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: { vehicleId: ctxA.vehicleId, waybillId: ctxA.waybillId, zoneId: ctxA.zoneId, temperature: -15, timestamp: T_A + 70 * 1000 },
  });
  await verifyConsistency({
    ...ctxA,
    expectedAlertCount: 1,
    expectedExceptionCount: 1,
    expectedExceptionDuration: 70,
    scenario: '超温 70s 后恢复',
  });
  console.log('');

  console.log('【场景 B】超温 30 秒就恢复（低于阈值 60s）→ 不生成正式告警，异常统计为 0');
  const ctxB = await setupTestFixture('BOUNDARY-B', THRESHOLD);
  const T_B = Date.now();
  await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: { vehicleId: ctxB.vehicleId, waybillId: ctxB.waybillId, zoneId: ctxB.zoneId, temperature: -5, timestamp: T_B },
  });
  await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: { vehicleId: ctxB.vehicleId, waybillId: ctxB.waybillId, zoneId: ctxB.zoneId, temperature: -15, timestamp: T_B + 30 * 1000 },
  });
  await verifyConsistency({
    ...ctxB,
    expectedAlertCount: 0,
    expectedExceptionCount: 0,
    expectedExceptionDuration: 0,
    scenario: '超温 30s 后恢复',
  });
  const { body: internalAlerts } = await request<any>({
    method: 'GET',
    path: `/api/alerts?waybillId=${ctxB.waybillId}&includeObserving=true`,
  });
  const hasInternalObserving = internalAlerts.data.alerts.some(
    (a: any) => a.result?.includes('未达到持续阈值')
  );
  assert('内部仍保留未达阈值观察记录（includeObserving=true 可见）', hasInternalObserving);
  console.log('');

  console.log('========================================');
  console.log(`总计: 通过 ${passed} / ${passed + failed}`);
  if (failed > 0) {
    console.log(`失败: ${failed}`);
    process.exit(1);
  } else {
    console.log('🎉 全部用例通过');
    process.exit(0);
  }
}

main().catch(e => {
  console.error('运行失败:', e.message);
  process.exit(1);
});
