import styles from './assessments.module.css';
import type { PageContext } from '../page-context';
import { connectedPreflight, connectedAssessment } from '../../../context/assessment-views.js';
export { connectedBooking as booking } from './booking';
export const preflight = (context: PageContext): string => `<section class="${styles.page}">${connectedPreflight(context)}</section>`;
export const assessment = (context: PageContext): string => `<section class="${styles.page}">${connectedAssessment(context)}</section>`;
