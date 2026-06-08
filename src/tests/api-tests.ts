import * as http from 'http';

const BASE = 'http://localhost:3000';

function request<T = any>(options: {
  method: string;
  path: string;
  body?: any;
}): Promise<T> {
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
        },
      },
      res => {
        let chunks = '';
        res.on('data', c => (chunks += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(chunks) as T);
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

async function main() {
  console.log('\n========== 冷链后端接口验证用例 ==========\n');

  console.log('【准备】创建测试车辆和运单（温区持续阈值 60 秒，-20 ~ -12°C）');
  const vehicleRes = await request<any>({
    method: 'POST',
    path: '/api/vehicles',
    body: {
      plateNumber: '测试-001',
      deviceId: 'TEST-DEV-001',
      driverName: '测试司机',
      driverPhone: '13900000000',
    },
  });
  const vehicleId = vehicleRes.data.id;

  const waybillRes = await request<any>({
    method: 'POST',
    path: '/api/waybills',
    body: {
      waybillNo: 'TEST-YB-' + Date.now(),
      vehicleId,
      customerId: 'TEST-CUST',
      customerName: '测试客户',
      goodsName: '测试冷冻品',
      origin: '起点仓',
      destination: '终点仓',
      temperatureZones: [
        {
          zoneName: '冷冻测试区',
          minTemp: -20,
          maxTemp: -12,
          durationThreshold: 60,
        },
      ],
    },
  });
  const waybillId = waybillRes.data.id;
  const waybillNo = waybillRes.data.waybillNo;
  const zoneId = waybillRes.data.temperatureZones[0].zoneId;
  console.log(`  车辆ID: ${vehicleId}\n  运单ID: ${waybillId}\n  温区ID: ${zoneId}\n`);

  const startT = Date.now();

  console.log('【用例 1】单次超温不告警');
  let r1 = await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: {
      vehicleId,
      waybillId,
      zoneId,
      temperature: -5,
      timestamp: startT,
    },
  });
  assert('单次超温上报接口返回成功', r1.code === 0);
  assert('单次超温未触发正式告警 (alertTriggered=false)', r1.data.alertTriggered === false);
  let list1 = await request<any>({ method: 'GET', path: `/api/alerts?waybillId=${waybillId}` });
  assert('告警列表为空（observing 被过滤）', list1.data.total === 0);
  let listAll1 = await request<any>({ method: 'GET', path: `/api/alerts?waybillId=${waybillId}&includeObserving=true` });
  assert('内部存在 1 条 observing 状态告警', listAll1.data.alerts.some((a: any) => a.status === 'observing'));
  console.log('');

  console.log('【用例 2】连续超温达到阈值后生成正式告警');
  await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: { vehicleId, waybillId, zoneId, temperature: -4, timestamp: startT + 30 * 1000 },
  });
  const r2 = await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: { vehicleId, waybillId, zoneId, temperature: -3, timestamp: startT + 70 * 1000 },
  });
  assert('第 3 条（累计 70s）超温触发正式告警', r2.data.alertTriggered === true);
  assert('正式告警状态为 pending', r2.data.alert && r2.data.alert.status === 'pending');
  assert('告警 durationSeconds 约等于持续时长 (>=60)', (r2.data.alert?.durationSeconds ?? 0) >= 60);
  let list2 = await request<any>({ method: 'GET', path: `/api/alerts?waybillId=${waybillId}` });
  assert('告警列表正式展示 1 条', list2.data.total === 1 && list2.data.alerts[0].status === 'pending');
  console.log('');

  console.log('【用例 3】温度恢复后重新计时（再次单点超温不告警）');
  await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: { vehicleId, waybillId, zoneId, temperature: -15, timestamp: startT + 80 * 1000 },
  });
  await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: { vehicleId, waybillId, zoneId, temperature: -6, timestamp: startT + 85 * 1000 },
  });
  let list3 = await request<any>({ method: 'GET', path: `/api/alerts?waybillId=${waybillId}` });
  assert('恢复后单点异常不会额外新增正式告警（总数仍然 1）', list3.data.total === 1);
  console.log('');

  console.log('【用例 4】客户报告异常时长不为 0');
  const report = await request<any>({ method: 'GET', path: `/api/reports/${waybillId}/summary` });
  const zoneReport = report.data.zones[0];
  console.log(`    异常次数 = ${zoneReport.exceptionCount}, 异常持续秒数 = ${zoneReport.exceptionDuration}`);
  assert('报告 exceptionDuration > 0', zoneReport.exceptionDuration > 0);
  assert('报告 exceptionCount >= 1', zoneReport.exceptionCount >= 1);
  console.log('');

  console.log('【用例 5】批量温度上报部分失败');
  const batchRes = await request<any>({
    method: 'POST',
    path: '/api/temperature/batch',
    body: {
      records: [
        { vehicleId, waybillId, zoneId, temperature: -14, timestamp: startT + 200 * 1000 },
        { vehicleId, waybillId, zoneId, timestamp: startT + 210 * 1000 },
        { vehicleId: 'NON-EXIST', temperature: -14, timestamp: startT + 220 * 1000 },
        { vehicleId, waybillId, zoneId, temperature: -16, timestamp: startT + 230 * 1000 },
      ],
    },
  });
  console.log(`    total=${batchRes.data.total}, successCount=${batchRes.data.successCount}, failedCount=${batchRes.data.failedCount}`);
  assert('批量返回总数 4', batchRes.data.total === 4);
  assert('成功 2 条', batchRes.data.successCount === 2);
  assert('失败 2 条', batchRes.data.failedCount === 2);
  const errorMsgs = batchRes.data.failedResults.flatMap((f: any) => f.errors as string[]);
  assert('失败记录包含"缺少有效 temperature 字段"错误', errorMsgs.includes('缺少有效 temperature 字段'));
  assert('失败记录包含"无法识别车辆"错误', errorMsgs.includes('无法识别车辆'));
  const tempList = await request<any>({ method: 'GET', path: `/api/temperature/waybill/${waybillId}` });
  assert('仅成功的记录入库（原 5 条 + 新 2 条 = 7 条）', tempList.data.total === 7);
  console.log('');

  console.log('【用例 6】客户通过运单号查询完整报告');
  const fullReport = await request<any>({ method: 'GET', path: `/api/reports/customer/${waybillNo}` });
  assert('客户报告返回运单号匹配', fullReport.data.waybillNo === waybillNo);
  assert('客户报告异常摘要 totalAlerts >= 1', fullReport.data.exceptionSummary.totalAlerts >= 1);
  assert('客户报告温区 exceptionDuration > 0', fullReport.data.zones[0].exceptionDuration > 0);
  console.log('');

  console.log('【用例 7】告警详情 durationSeconds 与报告时长匹配');
  const alertList = await request<any>({ method: 'GET', path: `/api/alerts?waybillId=${waybillId}` });
  const pendingAlert = alertList.data.alerts.find((a: any) => a.status === 'pending');
  assert('告警详情 durationSeconds >= 60 秒', (pendingAlert?.durationSeconds ?? 0) >= 60);
  console.log(`    告警持续秒数 = ${pendingAlert?.durationSeconds}`);
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
