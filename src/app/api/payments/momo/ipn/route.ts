import { ipnRoute } from '@/payments/routes';

/** IPN from momo. Public; verified by signature. */
export const { GET, POST } = ipnRoute('momo');
export const maxDuration = 300;   // may enqueue the resumed analysis (inline queue)
