import { ipnRoute } from '@/payments/routes';

/** IPN from vnpay. Public; verified by signature. */
export const { GET, POST } = ipnRoute('vnpay');
export const maxDuration = 300;   // may enqueue the resumed analysis (inline queue)
