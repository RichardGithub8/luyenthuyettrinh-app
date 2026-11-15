import { ipnRoute } from '@/payments/routes';

/** IPN from mock. Public; verified by signature. */
export const { GET, POST } = ipnRoute('mock');
export const maxDuration = 300;   // may enqueue the resumed analysis (inline queue)
