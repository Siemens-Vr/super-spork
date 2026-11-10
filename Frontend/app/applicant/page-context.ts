export interface ApplicantDemoState {
  name: string;
  discipline: string;
  career: string;
  booked: boolean;
  prepared: boolean;
  learning: boolean[];
  slot: number;
  messages: string[];
  started: boolean;
}

export interface PageContext {
  state: ApplicantDemoState;
  escape: (value: unknown) => string;
  heading: (title: string, subtitle: string, action?: string) => string;
  button: (text: string, href: string, className?: string) => string;
  card: (title: string, body: string, link?: string) => string;
  badge: (text: string, className?: string) => string;
  field: (label: string, name: string, value?: string, type?: string) => string;
  documents: () => string;
  icon: (name: string) => string;
  currentUser: () => { legalName: string; email?: string } | null;
  careers: string[];
}
