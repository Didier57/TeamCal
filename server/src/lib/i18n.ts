export type EmailLanguage = 'fr' | 'en' | 'de';

export interface EmailTexts {
  createdSubject: (title: string) => string;
  updatedSubject: (title: string) => string;
  cancelledSubject: (title: string) => string;
  intro: (action: 'created' | 'updated' | 'cancelled') => string;
  when: string;
  where: string;
  details: string;
  addToCalendar: string;
  subscribe: string;
  subscribeAction: string;
  footer: string;
  organizer: string;
  participants: string;
}

const texts: Record<EmailLanguage, EmailTexts> = {
  fr: {
    createdSubject: (t) => `Nouvel événement : ${t}`,
    updatedSubject: (t) => `Événement modifié : ${t}`,
    cancelledSubject: (t) => `Événement annulé : ${t}`,
    intro: (a) =>
      a === 'created'
        ? 'Un nouvel événement a été ajouté à votre planning.'
        : a === 'updated'
          ? 'Un événement de votre planning a été modifié.'
          : 'Un événement de votre planning a été annulé.',
    when: 'Date',
    where: 'Lieu',
    details: 'Description',
    addToCalendar: 'La pièce jointe invitation.ics permet d’ajouter ou de mettre à jour l’événement dans votre calendrier.',
    subscribe:
      'Pour que vos événements apparaissent automatiquement dans votre agenda, abonnez-vous une seule fois à votre planning TeamCal.',
    subscribeAction: 'Gérer mon abonnement',
    footer: 'Cet e-mail a été envoyé automatiquement par TeamCal.',
    organizer: 'Organisateur',
    participants: 'Participants'
  },
  en: {
    createdSubject: (t) => `New event: ${t}`,
    updatedSubject: (t) => `Event updated: ${t}`,
    cancelledSubject: (t) => `Event cancelled: ${t}`,
    intro: (a) =>
      a === 'created'
        ? 'A new event has been added to your schedule.'
        : a === 'updated'
          ? 'An event in your schedule has been updated.'
          : 'An event in your schedule has been cancelled.',
    when: 'Date',
    where: 'Location',
    details: 'Description',
    addToCalendar: 'The attached invitation.ics file lets you add or update the event in your calendar.',
    subscribe:
      'To have your events appear automatically in your calendar, subscribe once to your TeamCal schedule.',
    subscribeAction: 'Manage my subscription',
    footer: 'This e-mail was sent automatically by TeamCal.',
    organizer: 'Organizer',
    participants: 'Participants'
  },
  de: {
    createdSubject: (t) => `Neuer Termin: ${t}`,
    updatedSubject: (t) => `Termin geändert: ${t}`,
    cancelledSubject: (t) => `Termin abgesagt: ${t}`,
    intro: (a) =>
      a === 'created'
        ? 'Ein neuer Termin wurde Ihrem Kalender hinzugefügt.'
        : a === 'updated'
          ? 'Ein Termin in Ihrem Kalender wurde geändert.'
          : 'Ein Termin in Ihrem Kalender wurde abgesagt.',
    when: 'Datum',
    where: 'Ort',
    details: 'Beschreibung',
    addToCalendar: 'Die angehängte Datei invitation.ics fügt den Termin zu Ihrem Kalender hinzu oder aktualisiert ihn.',
    subscribe:
      'Damit Ihre Termine automatisch in Ihrem Kalender erscheinen, abonnieren Sie einmalig Ihren TeamCal-Kalender.',
    subscribeAction: 'Abonnement verwalten',
    footer: 'Diese E-Mail wurde automatisch von TeamCal gesendet.',
    organizer: 'Organisator',
    participants: 'Teilnehmer'
  }
};

export function emailTexts(language: string): EmailTexts {
  return texts[(language as EmailLanguage) in texts ? (language as EmailLanguage) : 'fr'];
}

export const uiTexts: Record<EmailLanguage, Record<string, string>> = {
  fr: { invitation: 'Invitation', update: 'Mise à jour', cancellation: 'Annulation' },
  en: { invitation: 'Invitation', update: 'Update', cancellation: 'Cancellation' },
  de: { invitation: 'Einladung', update: 'Aktualisierung', cancellation: 'Absage' }
};
