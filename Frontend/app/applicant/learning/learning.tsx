import styles from './learning.module.css';
import type { PageContext } from '../page-context';
import { connectedLearning } from '../../../context/assessment-views.js';
export const learning = (context: PageContext): string => `<section class="${styles.page}">${connectedLearning(context)}</section>`;
