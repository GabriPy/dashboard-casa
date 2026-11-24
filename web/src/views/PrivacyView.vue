<script setup>
import BrandMark from '@/components/BrandMark.vue';
</script>

<template>
  <main class="privacy-page">
    <header class="privacy-top">
      <RouterLink to="/" class="privacy-brand" aria-label="Torna a Ghibiri Home">
        <BrandMark :size="38" show-wordmark subtitle="casa di famiglia" />
      </RouterLink>
    </header>

    <div class="privacy-content">
      <p class="eyebrow">Trasparenza</p>
      <h1>Privacy e cookie</h1>
      <p class="privacy-lead">
        Questa informativa descrive i dati trattati da Ghibiri Home, le funzioni del browser utilizzate e i servizi esterni che possono intervenire.
      </p>
      <p class="privacy-updated">Aggiornata il 24 novembre 2026</p>

      <section class="card privacy-card">
        <h2>Titolare e ambito d’uso</h2>
        <p><strong>Gabriele Pili</strong> gestisce questa installazione di Ghibiri Home. Per domande o richieste relative ai dati puoi scrivere a <a href="mailto:ghibiri@gmail.com">ghibiri@gmail.com</a>.</p>
        <p>Il sito è destinato all’uso personale e familiare del nucleo domestico, non all’offerta di un servizio al pubblico o a fini commerciali. Se l’uso viene esteso a persone esterne al nucleo o ad attività diverse, questa informativa e le relative basi giuridiche dovranno essere rivalutate prima dell’estensione.</p>
      </section>

      <section class="card privacy-card">
        <h2>Dati trattati e finalità</h2>
        <ul>
          <li><strong>Profili e accesso:</strong> nome, immagine/emoji, colore, email facoltativa, PIN conservato solo in forma di hash, sessioni e preferenze. Servono a identificare i profili, autenticare l’accesso e personalizzare l’interfaccia.</li>
          <li><strong>Organizzazione familiare:</strong> eventi, scadenze, spesa, ricette, piante, veicoli, dispositivi domotici e relative registrazioni, per fornire le funzioni richieste dagli utenti.</li>
          <li><strong>Farmaci:</strong> nome, dose, frequenza, orari, note e registrazioni di assunzione. Queste informazioni possono rivelare dati relativi alla salute. I farmaci privati sono visibili al profilo assegnato; quelli condivisi sono visibili ai profili della casa. Le notifiche push dei farmaci hanno un testo generico e non riportano il nome.</li>
          <li><strong>Sicurezza e funzionamento:</strong> log delle azioni, data e ora, tentativi di accesso e dati tecnici di sessione (indirizzo IP e user-agent) per autenticazione, diagnosi e protezione dell’installazione.</li>
          <li><strong>Notifiche push:</strong> identificativo dell’endpoint e chiavi tecniche della sottoscrizione, per inviare notifiche ai dispositivi che l’utente ha autorizzato.</li>
        </ul>
        <p>I PIN non vengono salvati in chiaro. I dati sono conservati nel database e negli allegati dell’installazione configurata dal titolare, che ne amministra anche il server e i backup. Chi controlla il server può tecnicamente accedere al database completo, inclusi i dati privati.</p>
      </section>

      <section class="card privacy-card">
        <h2>Visibilità e condivisione in famiglia</h2>
        <p>I dati contrassegnati come condivisi sono accessibili ai profili della casa autenticati. Eventi e scadenze privati sono riservati a chi li ha creati; i farmaci privati sono riservati al profilo assegnato. I contenuti privati non sono mostrati agli altri profili nell’interfaccia, ma non sono cifrati in modo da impedirne l’accesso a chi amministra direttamente il server o i backup.</p>
        <p>La pagina Farmaci è un registro organizzativo: non sostituisce le indicazioni di medici o farmacisti.</p>
      </section>

      <section class="card privacy-card">
        <h2>Servizi esterni</h2>
        <p>L’app non include analytics, pubblicità, tracker, font o CDN remoti. Alcune funzioni possono tuttavia coinvolgere servizi scelti o configurati dal titolare:</p>
        <ul>
          <li><strong>Cloudflare Tunnel</strong>, se usato per pubblicare il sito: il traffico passa attraverso l’infrastruttura Cloudflare.</li>
          <li><strong>Servizio push del browser:</strong> il provider associato al browser/dispositivo riceve la richiesta di consegna e i dati tecnici necessari alla sottoscrizione. Le push dei farmaci non contengono il nome del farmaco.</li>
          <li><strong>Provider AI:</strong> solo se configurato e quando viene usata la generazione di ricette, il testo della richiesta e gli ingredienti inseriti vengono inviati al provider impostato dal titolare. I dati della sezione Farmaci non vengono inviati a questa funzione.</li>
          <li><strong>Home Assistant:</strong> se configurato, l’app comunica con l’istanza indicata dal titolare per leggere stati e inviare i comandi richiesti.</li>
        </ul>
        <p>I servizi opzionali hanno condizioni e informative proprie; prima di abilitarli il titolare dovrebbe verificare i rispettivi termini, luoghi di trattamento e garanzie sui trasferimenti di dati.</p>
      </section>

      <section class="card privacy-card">
        <h2>Cookie e archiviazione nel browser</h2>
        <div class="privacy-table-wrap">
          <table>
            <thead>
              <tr><th>Nome</th><th>Tipo</th><th>Uso e durata</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><code>gh_sess</code></td>
                <td>Cookie tecnico di sessione</td>
                <td>Mantiene l’accesso al profilo. HttpOnly e SameSite=Lax; Secure quando il sito usa HTTPS. Scade dopo 30 giorni per impostazione predefinita o al logout.</td>
              </tr>
              <tr>
                <td><code>gh:last-profile</code></td>
                <td>localStorage</td>
                <td>Ricorda sul dispositivo l’ID dell’ultimo profilo scelto nella schermata di accesso. Resta finché non viene cancellato dai dati del browser.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>Queste funzioni sono usate per l’accesso e il funzionamento richiesto dell’app; non vengono usate per tracciare la navigazione o per pubblicità. Per questo non è previsto un banner di consenso per cookie non essenziali. Le push richiedono un’autorizzazione separata del browser e non sono cookie.</p>
      </section>

      <section class="card privacy-card">
        <h2>Conservazione e controllo</h2>
        <ul>
          <li>I dati inseriti restano nell’installazione finché un profilo autorizzato non li modifica o elimina, oppure finché il titolare non rimuove i dati dell’installazione.</li>
          <li>Le sessioni hanno una durata predefinita di 30 giorni; l’uscita elimina la sessione corrente. I record scaduti vengono ripuliti durante un successivo accesso.</li>
          <li>I log di attività non hanno una cancellazione automatica configurata. Gli endpoint push restano registrati finché vengono disattivati dal profilo, rimossi dal titolare o risultano scaduti.</li>
          <li>I backup sono manuali e possono contenere il database completo e gli allegati. Le copie esportate vanno custodite e cancellate dal titolare quando non sono più necessarie.</li>
        </ul>
        <p>Per correggere o rimuovere informazioni, disattivare una sottoscrizione push o fare una richiesta sui dati, contatta il titolare all’indirizzo indicato sopra. Se alla situazione concreta si applica la normativa europea sulla protezione dei dati, puoi inoltre esercitare i diritti previsti dalla legge e presentare reclamo al Garante per la protezione dei dati personali.</p>
      </section>

      <footer class="privacy-footer">
        <RouterLink to="/">Torna a Ghibiri Home</RouterLink>
        <span>Ghibiri Home · uso personale e familiare</span>
      </footer>
    </div>
  </main>
</template>

<style scoped>
.privacy-page {
  min-height: 100dvh;
  padding: 22px clamp(18px, 4vw, 56px) 48px;
  background:
    radial-gradient(80% 45% at 50% 0%, rgba(196, 98, 63, 0.08), transparent 70%),
    var(--bg);
}
.privacy-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  max-width: 1040px;
  margin: 0 auto;
}
.privacy-brand {
  color: inherit;
  text-decoration: none;
}
.privacy-content {
  width: min(820px, 100%);
  margin: 42px auto 0;
}
.privacy-content > .eyebrow {
  margin: 0 0 8px;
}
h1 {
  margin: 0;
  color: var(--ink);
  font-family: var(--font-serif);
  font-size: clamp(34px, 5vw, 48px);
  line-height: 1.05;
}
.privacy-lead {
  max-width: 66ch;
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.65;
}
.privacy-updated {
  margin: 10px 0 24px;
  color: var(--muted);
  font-size: 12px;
}
.privacy-card {
  margin-top: 12px;
  padding: clamp(18px, 3vw, 26px);
}
.privacy-card h2 {
  margin: 0 0 12px;
  font-family: var(--font-serif);
  font-size: 21px;
}
.privacy-card p,
.privacy-card li {
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.7;
}
.privacy-card p {
  margin: 0 0 10px;
}
.privacy-card p:last-child {
  margin-bottom: 0;
}
.privacy-card ul {
  display: grid;
  gap: 9px;
  margin: 0 0 12px;
  padding-left: 20px;
}
.privacy-card strong {
  color: var(--ink);
}
.privacy-card a,
.privacy-footer a {
  color: var(--primary);
  text-underline-offset: 3px;
}
.privacy-table-wrap {
  overflow-x: auto;
  margin-bottom: 12px;
}
table {
  width: 100%;
  border-collapse: collapse;
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.55;
}
th,
td {
  padding: 10px 11px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  vertical-align: top;
}
th {
  color: var(--ink);
  font-size: 11px;
  font-weight: 700;
}
td:first-child {
  white-space: nowrap;
}
code {
  padding: 2px 5px;
  border-radius: 5px;
  background: var(--surface-2);
  color: var(--ink);
}
.privacy-footer {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
  color: var(--muted);
  font-size: 12px;
}
@media (max-width: 600px) {
  .privacy-page {
    padding-top: 16px;
  }
  .privacy-content {
    margin-top: 30px;
  }
}
</style>
