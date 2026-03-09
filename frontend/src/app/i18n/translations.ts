import { SafeHtml } from '@angular/platform-browser';

export interface Translations {
  // Page
  pageTitle: string;
  // Topbar buttons
  displaySettings: string;
  massStartSettings: string;
  // Follow setting
  followLabel: string;
  followPopoverTitle: string;
  followPopoverBody: string;
  // Max gap setting
  maxGapLabel: string;
  maxGapPopoverTitle: string;
  maxGapPopoverBody: string;
  // Max groups setting
  maxGroupsLabel: string;
  maxGroupsPopoverTitle: string;
  maxGroupsPopoverBody: string;
  // Lap variance setting
  lapDeltaLabel: string;
  lapVariancePopoverTitle: string;
  lapVariancePopoverBody: string;
  lapVariancePopoverExample: string;
  // Lap times setting
  lapTimesLabel: string;
  showLapTimesPopoverTitle: string;
  showLapTimesPopoverBody: string;
  // Badges
  badgeLive: string;
  badgeDone: string;
  badgeLeader: string;
  badgeFinalLap: string;
  // Distance header
  lapUnit: string;
  lapsUnit: string;
  // Groups / heats
  headOfRace: string;
  tailOfRace: string;
  groupLabel: string;  // contains {n}
  heatLabel: string;   // contains {n}
  heatMergedLabel: string; // contains {a} and {b}
  // Race events
  lapCompleted: string;
  finished: string;
  // Timed personal best label and remarks
  pbLabel: string;
  remarkNewPb: string;
  remarkFall: string;
  remarkDisqualified: string;
  remarkDidNotStart: string;
  remarkDidNotFinish: string;
  remarkWithdrawn: string;
  remarkNewTrackRecord: string;
  // Mass start lap counter (HTML, contains underline span)
  moreLapAfterRound: string;   // singular
  moreLapsAfterRound: string;  // plural
}

export const en: Translations = {
  pageTitle: 'Live Results Dashboard',
  displaySettings: 'Display',
  massStartSettings: 'Mass Start',
  followLabel: 'Automatically follow & scroll',
  followPopoverTitle: 'Automatically follow & scroll',
  followPopoverBody: 'Automatically scroll to keep the live distance in view as results come in.',
  maxGapLabel: 'Max seconds gap between groups',
  maxGapPopoverTitle: 'Max seconds gap between groups',
  maxGapPopoverBody:
    'Minimum time difference (in seconds) between two competitors <strong>on the same lap</strong> for them to be placed in <strong>separate</strong> standings groups. <br><br>Lower values create more groups; 0 puts every competitor in their own group.<br><br>For comparison: Marathon races maintain a <strong>two second gap</strong> to indicate when a group is formed and which competitors are part of it.',
  maxGroupsLabel: 'Max groups',
  maxGroupsPopoverTitle: 'Max groups',
  maxGroupsPopoverBody:
    'Maximum number of standings groups to display in the group strip. Groups are based on the <i>Max seconds gap between groups</i> set to the left. <br><br>Competitors beyond the last group are collected into a \u201cTail of the race\u201d group. <br><br>Set to 0 to disable grouping entirely.',
  lapDeltaLabel: 'Lap \u0394',
  lapVariancePopoverTitle: 'Lap variance threshold',
  lapVariancePopoverBody:
    'Percentage difference between <strong>consecutive lap times</strong> used to colour lap badges. <br><br><span class="popover-badge popover-badge-green">green</span> \u2192 Within threshold <br><span class="popover-badge popover-badge-orange">orange</span> \u2192 Slower than threshold <br><span class="popover-badge popover-badge-purple">purple</span> \u2192 Faster than threshold',
  lapVariancePopoverExample:
    'E.g. at 5%: a previous lap of 30.0\u202fs means slower\u202f>\u202f31.5\u202fs turns orange, faster\u202f<\u202f28.5\u202fs turns purple.',
  lapTimesLabel: 'Lap times',
  showLapTimesPopoverTitle: 'Show lap times',
  showLapTimesPopoverBody:
    'Show or hide the lap time badge strip on each mass-start competitor row. Hiding lap times gives a cleaner view during busy races.',
  badgeLive: 'Live',
  badgeDone: 'Done',
  badgeLeader: 'Leader',
  badgeFinalLap: 'Final lap',
  lapUnit: 'lap',
  lapsUnit: 'laps',
  headOfRace: 'Head of the race',
  tailOfRace: 'Tail of the race',
  groupLabel: 'Group {n}',
  heatLabel: 'Heat {n}',
  heatMergedLabel: 'Heat {a} & {b}',
  lapCompleted: 'Lap completed',
  finished: 'Finished',
  pbLabel: 'PB:',
  remarkNewPb: 'New PB',
  remarkFall: 'Fall',
  remarkDisqualified: 'Disqualified',
  remarkDidNotStart: 'Did not start',
  remarkDidNotFinish: 'Did not finish',
  remarkWithdrawn: 'Withdrawn',
  remarkNewTrackRecord: 'New Track Record',
  moreLapAfterRound: '{n} more lap <span style="text-decoration:underline">after</span> this round',
  moreLapsAfterRound: '{n} more laps <span style="text-decoration:underline">after</span> this round',
};

export const nl: Translations = {
  pageTitle: 'Live Resultaten Dashboard',
  displaySettings: 'Weergave',
  massStartSettings: 'Massastart',
  followLabel: 'Automatisch volgen & scrollen',
  followPopoverTitle: 'Automatisch volgen & scrollen',
  followPopoverBody: 'Scroll automatisch mee om de live afstand in beeld te houden terwijl resultaten binnenkomen.',
  maxGapLabel: 'Max. seconden verschil tussen groepen',
  maxGapPopoverTitle: 'Max. seconden verschil tussen groepen',
  maxGapPopoverBody:
    'Minimaal tijdsverschil (in seconden) tussen twee deelnemers <strong>op dezelfde ronde</strong> om ze in <strong>aparte</strong> groepen te plaatsen. <br><br>Lagere waarden geven meer groepen; 0 plaatst elke deelnemer in een eigen groep.<br><br>Ter vergelijking: bij marathons hanteert men een <strong>twee seconden verschil</strong> om aan te geven wanneer een groep wordt gevormd.',
  maxGroupsLabel: 'Max. groepen',
  maxGroupsPopoverTitle: 'Max. groepen',
  maxGroupsPopoverBody:
    'Maximaal aantal rangschikkingsgroepen in de groepsstrip. Groepen zijn gebaseerd op het <i>Max. seconden verschil tussen groepen</i>. <br><br>Deelnemers buiten de laatste groep worden samengebracht in een \u201cStaart van de race\u201d-groep. <br><br>Stel in op 0 om groepering volledig uit te schakelen.',
  lapDeltaLabel: 'Ronde \u0394',
  lapVariancePopoverTitle: 'Rondetijd variatie drempel',
  lapVariancePopoverBody:
    'Procentueel verschil tussen <strong>opeenvolgende rondetijden</strong> voor de kleur van rondetijd-badges. <br><br><span class="popover-badge popover-badge-green">groen</span> \u2192 Binnen drempel <br><span class="popover-badge popover-badge-orange">oranje</span> \u2192 Trager dan drempel <br><span class="popover-badge popover-badge-purple">paars</span> \u2192 Sneller dan drempel',
  lapVariancePopoverExample:
    'Bijv. bij 5%: een vorige ronde van 30,0\u202fs betekent trager\u202f>\u202f31,5\u202fs wordt oranje, sneller\u202f<\u202f28,5\u202fs wordt paars.',
  lapTimesLabel: 'Rondetijden',
  showLapTimesPopoverTitle: 'Rondetijden tonen',
  showLapTimesPopoverBody:
    'Toon of verberg de rondetijd-badge-strip op elke massastart-deelnemer. Verbergen geeft een overzichtelijker beeld tijdens drukke wedstrijden.',
  badgeLive: 'Live',
  badgeDone: 'Klaar',
  badgeLeader: 'Leider',
  badgeFinalLap: 'Laatste ronde',
  lapUnit: 'ronde',
  lapsUnit: 'ronden',
  headOfRace: 'Kop van de race',
  tailOfRace: 'Staart van de race',
  groupLabel: 'Groep {n}',
  heatLabel: 'Serie {n}',
  heatMergedLabel: 'Serie {a} & {b}',
  lapCompleted: 'Ronde voltooid',
  finished: 'Gefinisht',
  pbLabel: 'PR:',
  remarkNewPb: 'Nieuw PR',
  remarkFall: 'Val',
  remarkDisqualified: 'Gediskwalificeerd',
  remarkDidNotStart: 'Niet gestart',
  remarkDidNotFinish: 'Niet gefinisht',
  remarkWithdrawn: 'Teruggetrokken',
  remarkNewTrackRecord: 'Nieuw baanrecord',
  moreLapAfterRound: 'nog {n} ronde <span style="text-decoration:underline">na</span> deze ronde',
  moreLapsAfterRound: 'nog {n} ronden <span style="text-decoration:underline">na</span> deze ronde',
};
