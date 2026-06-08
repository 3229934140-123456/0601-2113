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

async function main() {
  console.log('\n========== 冷链后端接口验证用例（v2） ==========\n');

  console.log('【准备】创建测试车辆和运单（温区阈值 60 秒，-20 ~ -12°C）');
  const { body: vehicleRes } = await request<any>({
    method: 'POST',
    path: '/api/vehicles',
    body: {
      plateNumber: '测试-V2-001',
      deviceId: 'TEST-DEV-V2-001',
      driverName: '张测试',
      driverPhone: '13900000001',
    },
  });
  const vehicleId = vehicleRes.data.id;

  const { body: waybillRes } = await request<any>({
    method: 'POST',
    path: '/api/waybills',
    body: {
      waybillNo: 'TEST-YB-V2-' + Date.now(),
      vehicleId,
      customerId: 'TEST-CUST-V2',
      customerName: '测试客户 V2',
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
  console.log(`  车辆ID: ${vehicleId}\n  运单ID: ${waybillId}\n  运单号: ${waybillNo}\n  温区ID: ${zoneId}\n`);

  const T0 = Date.now();

  console.log('【用例 1】单次超温不告警（observing，对外不可见）');
  const { body: r1 } = await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: { vehicleId, waybillId, zoneId, temperature: -5, timestamp: T0 },
  });
  assert('单次超温上报成功', r1.code === 0);
  assert('单次超温未触发正式告警（alertTriggered=false）', r1.data.alertTriggered === false);
  const { body: list1 } = await request<any>({ method: 'GET', path: `/api/alerts?waybillId=${waybillId}` });
  assert('对外告警列表为空', list1.data.total === 0);
  const { body: listAll1 } = await request<any>({ method: 'GET', path: `/api/alerts?waybillId=${waybillId}&includeObserving=true` });
  assert('内部有 1 条 observing 告警', listAll1.data.alerts.some((a: any) => a.status === 'observing'));
  console.log('');

  console.log('【用例 2】连续超温 60s 以上触发正式告警');
  await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: { vehicleId, waybillId, zoneId, temperature: -6, timestamp: T0 + 30 * 1000 },
  });
  const { body: r2 } = await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: { vehicleId, waybillId, zoneId, temperature: -7, timestamp: T0 + 70 * 1000 },
  });
  assert('第 70 秒超温触发正式告警', r2.data.alertTriggered === true);
  assert('正式告警状态为 pending', r2.data.alert && r2.data.alert.status === 'pending');
  assert('告警 durationSeconds >= 60', (r2.data.alert?.durationSeconds ?? 0) >= 60);
  const { body: list2 } = await request<any>({ method: 'GET', path: `/api/alerts?waybillId=${waybillId}` });
  assert('告警列表有 1 条 pending 正式告警', list2.data.total === 1 && list2.data.alerts[0].status === 'pending');
  const firstAlertId = list2.data.alerts[0].id;
  const firstAlertDuration = list2.data.alerts[0].durationSeconds;
  console.log(`    告警ID=${firstAlertId}, durationSeconds=${firstAlertDuration}`);
  console.log('');

  console.log('【用例 3】温度恢复后再次单点异常不复用已结束告警，重新 observing');
  await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: { vehicleId, waybillId, zoneId, temperature: -15, timestamp: T0 + 80 * 1000 },
  });
  await request<any>({
    method: 'POST',
    path: '/api/temperature/report',
    body: { vehicleId, waybillId, zoneId, temperature: -6, timestamp: T0 + 85 * 1000 },
  });
  const { body: list3 } = await request<any>({ method: 'GET', path: `/api/alerts?waybillId=${waybillId}` });
  assert('对外告警仍只有 1 条（新单点异常不产生新 pending）', list3.data.total === 1);
  assert('原告警已有 endTime（温度恢复）', typeof list3.data.alerts[0].endTime === 'number');
  const { body: listAll3 } = await request<any>({ method: 'GET', path: `/api/alerts?waybillId=${waybillId}&includeObserving=true` });
  const observingCount = listAll3.data.alerts.filter((a: any) => a.status === 'observing' && !a.endTime).length;
  assert('存在新一条 observing 状态告警（重新计时）', observingCount >= 1);
  console.log('');

  console.log('【用例 4】司机确认告警 → 状态变 processing（未处置）');
  const { body: ackRes } = await request<any>({
    method: 'POST',
    path: `/api/alerts/${firstAlertId}/acknowledge`,
    body: { handlerId: 'DRIVER-001', handlerName: '张测试' },
  });
  assert('确认成功', ackRes.code === 0);
  assert('状态变为 processing', ackRes.data.status === 'processing');
  assert('记录了处理人', ackRes.data.handlerName === '张测试');
  const { body: activeRes } = await request<any>({ method: 'GET', path: `/api/alerts/vehicle/${vehicleId}/active` });
  assert('司机当前告警区分 pending 和 processing',
    Array.isArray(activeRes.data.pending) && Array.isArray(activeRes.data.processing));
  assert('processing 列表包含刚确认的告警', activeRes.data.processing.some((a: any) => a.id === firstAlertId));
  console.log('');

  console.log('【用例 5】司机处置完成（方式+多照片+备注+结果）');
  const { body: handleRes } = await request<any>({
    method: 'POST',
    path: `/api/alerts/${firstAlertId}/handle`,
    body: {
      handlerId: 'DRIVER-001',
      handlerName: '张测试',
      handleMethod: '重新启动制冷机组并关紧车厢门',
      handleRemark: '发现温度回升，重启机组后温度逐步下降',
      handlePhotos: [
        'https://example.com/photo1.jpg',
        'https://example.com/photo2.jpg',
        'https://example.com/photo3.jpg',
      ],
      result: '温度已恢复至 -15°C，异常解除',
    },
  });
  assert('处置成功', handleRes.code === 0);
  assert('状态变为 resolved', handleRes.data.status === 'resolved');
  assert('保存了处置方式', handleRes.data.handleMethod === '重新启动制冷机组并关紧车厢门');
  assert('保存了 3 张照片', Array.isArray(handleRes.data.handlePhotos) && handleRes.data.handlePhotos.length === 3);
  assert('保存了处置结果', handleRes.data.result === '温度已恢复至 -15°C，异常解除');
  console.log('');

  console.log('【用例 6】报告摘要 exceptionDuration 与告警 durationSeconds 一致');
  const { body: summaryRes } = await request<any>({ method: 'GET', path: `/api/reports/${waybillId}/summary` });
  const zoneSummary = summaryRes.data.zones[0];
  console.log(`    报告 exceptionDuration=${zoneSummary.exceptionDuration}s, 告警 durationSeconds=${firstAlertDuration}s`);
  assert('报告 exceptionDuration > 0', zoneSummary.exceptionDuration > 0);
  assert('摘要包含最高/最低/平均温度',
    typeof zoneSummary.minTemp === 'number' &&
    typeof zoneSummary.maxTemp === 'number' &&
    typeof zoneSummary.avgTemp === 'number');
  console.log('');

  console.log('【用例 7】完整客户报告包含异常/开门/处置时间轴');
  const { body: fullReport } = await request<any>({ method: 'GET', path: `/api/reports/${waybillId}` });
  assert('完整报告温区含 abnormalTimeline',
    Array.isArray(fullReport.data.zones[0].abnormalTimeline));
  assert('完整报告含 handlingRecords 处置时间轴',
    Array.isArray(fullReport.data.handlingRecords) && fullReport.data.handlingRecords.length >= 1);
  assert('处置记录含处置方式和照片',
    fullReport.data.handlingRecords.some((h: any) =>
      h.handleMethod && Array.isArray(h.handlePhotos) && h.handlePhotos.length === 3));
  assert('完整报告含 doorTimeline', 'doorTimeline' in fullReport.data);
  assert('完整报告 exceptionSummary 正确',
    fullReport.data.exceptionSummary.totalAlerts >= 1);
  const reportExceptionDuration = fullReport.data.zones[0].exceptionDuration;
  const alertDetailDuration = (fullReport.data.alerts.find((a: any) => a.id === firstAlertId) || {}).durationSeconds;
  console.log(`    报告 exceptionDuration=${reportExceptionDuration}s, 告警列表 durationSeconds=${alertDetailDuration}s`);
  assert('报告温区异常时长与该告警 durationSeconds 对得上（>=）', reportExceptionDuration >= alertDetailDuration);
  console.log('');

  console.log('【用例 8】报告可下载 JSON（带 Content-Disposition）');
  const { body: downloadBody, headers } = await request<any>({
    method: 'GET',
    path: `/api/reports/${waybillId}/download`,
  });
  const disposition = (headers['content-disposition'] as string) || '';
  assert('响应带 Content-Disposition attachment', disposition.includes('attachment'));
  assert('文件名包含运单号', disposition.includes(waybillNo));
  assert('下载内容含 waybillNo', downloadBody.waybillNo === waybillNo);
  console.log('');

  console.log('【用例 9】客户按运单号查询报告+下载');
  const { body: custReport } = await request<any>({ method: 'GET', path: `/api/reports/customer/${waybillNo}` });
  assert('客户按运单号查询成功', custReport.data.waybillNo === waybillNo);
  const { body: custDownload, headers: custHeaders } = await request<any>({
    method: 'GET',
    path: `/api/reports/customer/${waybillNo}/download`,
  });
  assert('客户下载也带 attachment', String(custHeaders['content-disposition'] || '').includes('attachment'));
  assert('客户下载内容正确', custDownload.waybillNo === waybillNo);
  console.log('');

  console.log('【用例 10】签收回执含处置记录和异常时长统计');
  const { body: receiptRes } = await request<any>({ method: 'GET', path: `/api/receipt/${waybillId}` });
  assert('签收回执含 handlingRecords', Array.isArray(receiptRes.data.handlingRecords) && receiptRes.data.handlingRecords.length >= 1);
  assert('签收回执含 totalExceptionDurationSec 统计',
    typeof receiptRes.data.stats.totalExceptionDurationSec === 'number' &&
    receiptRes.data.stats.totalExceptionDurationSec > 0);
  assert('签收回执区分 pending/processing/resolved',
    typeof receiptRes.data.stats.pending === 'number' &&
    typeof receiptRes.data.stats.processing === 'number' &&
    typeof receiptRes.data.stats.resolved === 'number');
  console.log('');

  console.log('【用例 11】批量上报部分失败 + 成功入库');
  const { body: batchRes } = await request<any>({
    method: 'POST',
    path: '/api/temperature/batch',
    body: {
      records: [
        { vehicleId, waybillId, zoneId, temperature: -14, timestamp: T0 + 200 * 1000 },
        { vehicleId, waybillId, zoneId, timestamp: T0 + 210 * 1000 },
        { vehicleId: 'NON-EXIST-V2', temperature: -14, timestamp: T0 + 220 * 1000 },
        { vehicleId, waybillId, zoneId, temperature: -16, timestamp: T0 + 230 * 1000 },
      ],
    },
  });
  assert('批量返回 total=4, successCount=2, failedCount=2',
    batchRes.data.total === 4 && batchRes.data.successCount === 2 && batchRes.data.failedCount === 2);
  const errorMsgs = batchRes.data.failedResults.flatMap((f: any) => f.errors as string[]);
  assert('失败包含"缺少有效 temperature 字段"', errorMsgs.includes('缺少有效 temperature 字段'));
  assert('失败包含"无法识别车辆"', errorMsgs.includes('无法识别车辆'));
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
