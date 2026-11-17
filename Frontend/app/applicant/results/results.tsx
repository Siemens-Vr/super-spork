import styles from './results.module.css';
import type { PageContext } from '../page-context';
import { connectedResults } from '../../../context/assessment-views.js';
export const results = (context: PageContext): string => `<section class="${styles.page}">${connectedResults(context)}</section>`;
