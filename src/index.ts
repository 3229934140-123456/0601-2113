import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import vehiclesRouter from './routes/vehicles';
import waybillsRouter from './routes/waybills';
import temperatureRouter from './routes/temperature';
import alertsRouter from './routes/alerts';
import tracksRouter from './routes/tracks';
import receiptRouter from './routes/receipt';
import reportsRouter from './routes/reports';
import { seedDemoData } from './seed';
import { success } from './utils/response';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  success(res, {
    service: 'Cold Chain Transport Backend Service',
    version: '1.0.0',
    description: '公路运输冷链异常监控后端服务',
    endpoints: {
      vehicles: '/api/vehicles',
      waybills: '/api/waybills',
      temperature: '/api/temperature',
      alerts: '/api/alerts',
      tracks: '/api/tracks',
      receipt: '/api/receipt',
      reports: '/api/reports',
    },
  });
});

app.get('/health', (req, res) => {
  success(res, { status: 'ok', timestamp: Date.now() });
});

app.use('/api/vehicles', vehiclesRouter);
app.use('/api/waybills', waybillsRouter);
app.use('/api/temperature', temperatureRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/tracks', tracksRouter);
app.use('/api/receipt', receiptRouter);
app.use('/api/reports', reportsRouter);

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    code: 500,
    message: err.message || '服务器内部错误',
    timestamp: Date.now(),
  });
});

seedDemoData();

app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`冷链运输温控后端服务已启动`);
  console.log(`服务地址: http://localhost:${PORT}`);
  console.log(`健康检查: http://localhost:${PORT}/health`);
  console.log(`API文档: http://localhost:${PORT}/`);
  console.log(`========================================`);
});

export default app;
