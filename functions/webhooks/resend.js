import { reenviar } from '../_proxy.js';

export const onRequest = ({ request }) => reenviar(request, 'resend-webhook');
