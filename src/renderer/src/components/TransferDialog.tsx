import { useState } from 'react'
import type { ImportSummary } from '../../../shared/types'
import { useStore } from '../store'
import { platform } from '../platform'
import {
  DOCUMENT_ACCEPT,
  importDocuments,
  type DocumentImportSummary
} from '../importers/documents'

export function TransferDialog(): React.JSX.Element {
  const setOpen = useStore((s) => s.setTransferOpen)
  const load = useStore((s) => s.load)
  const open = useStore((s) => s.open)
  const exportPage = useStore((s) => s.exportPage)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const web = platform().kind === 'web'
  const canImport = !['reader', 'guest'].includes(platform().session?.user.role ?? '')
  const [docs, setDocs] = useState<DocumentImportSummary | null>(null)

  const chooseDocuments = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = DOCUMENT_ACCEPT
    input.onchange = async () => {
      const files = Array.from(input.files ?? [])
      if (!files.length) return
      setBusy(true)
      setError(null)
      setDocs(null)
      try {
        setDocs(await importDocuments(files, null))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        await load()
        setBusy(false)
      }
    }
    input.click()
  }

  const runImport = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.transfer.importNotion()
      if (result) {
        setSummary(result)
        await load()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onMouseDown={() => !busy && setOpen(false)}>
      <div className="dialog transfer" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Importer / Exporter</h3>
        <div className="results">
          <section className="transfer-section">
            <h4>Importer depuis Notion</h4>
            <p>
              Dans Notion : <em>Paramètres</em> &gt;{' '}
              <em>Exporter tout le contenu de l’espace de travail</em>, format{' '}
              <strong>Markdown &amp; CSV</strong>, avec « Inclure les sous-pages » et « Créer des
              dossiers pour les sous-pages ».{' '}
              {web
                ? 'Choisissez ensuite le fichier .zip reçu : son contenu rejoint l’espace partagé du serveur.'
                : 'Choisissez ensuite le fichier .zip reçu (ou le dossier extrait). Tout reste sur cet ordinateur.'}
            </p>
            <button
              className="primary"
              disabled={busy || ['reader', 'guest'].includes(platform().session?.user.role ?? '')}
              onClick={() => void runImport()}
            >
              {busy ? 'Import en cours…' : 'Choisir un export Notion…'}
            </button>
            {error && <p className="error">Import impossible : {error}</p>}
            {summary && (
              <ImportReport
                summary={summary}
                onOpen={() => (open(summary.containerId), setOpen(false))}
              />
            )}
          </section>
          <section className="transfer-section">
            <h4>Importer d’autres outils</h4>
            <p>
              Word (.docx ; Google Docs : <em>Fichier &gt; Télécharger &gt; Microsoft Word</em>),
              pages web (.html), Markdown (.md), texte (.txt), Evernote (export .enex), Confluence
              (export HTML de l’espace, .zip) ou Google Docs en « Page Web (.zip) ». Chaque document
              devient une page, images comprises.
            </p>
            <button disabled={busy || !canImport} onClick={chooseDocuments}>
              {busy ? 'Import en cours…' : 'Choisir des fichiers…'}
            </button>
            {docs && (
              <div className="import-report">
                <p>
                  {docs.pages} page(s) créée(s)
                  {docs.images ? `, ${docs.images} image(s)` : ''}
                  {docs.files ? `, ${docs.files} pièce(s) jointe(s)` : ''}.
                  {docs.missing
                    ? ` ${docs.missing} image(s) ou pièce(s) jointe(s) non reprise(s).`
                    : ''}
                  {docs.skipped.length ? ` Format non reconnu : ${docs.skipped.join(', ')}.` : ''}
                </p>
                {docs.firstId && (
                  <button onClick={() => (open(docs.firstId), setOpen(false))}>Ouvrir</button>
                )}
              </div>
            )}
          </section>
          <section className="transfer-section">
            <h4>Exporter vers Markdown</h4>
            <p>
              Toutes les pages (hors corbeille) dans une archive .zip : un fichier .md par page,
              images comprises, un dossier par page ayant des sous-pages, liens entre pages
              conservés. Une seule page : menu « ⋯ » de la page dans la barre latérale.
            </p>
            <button disabled={busy} onClick={() => void exportPage(null)}>
              Exporter toutes les pages…
            </button>{' '}
            <button
              disabled={busy}
              onClick={() =>
                void window.api.transfer
                  .exportHtml(null)
                  .then((r) => r && setError(null))
                  .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              }
            >
              En HTML…
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}

function ImportReport({
  summary,
  onOpen
}: {
  summary: ImportSummary
  onOpen: () => void
}): React.JSX.Element {
  const notes: string[] = []
  if (summary.skipped)
    notes.push(`${summary.skipped} page(s) déjà importées, laissées telles quelles.`)
  if (summary.databases)
    notes.push(
      `${summary.databases} base(s) de données importée(s), types de propriétés déduits des CSV (formules, rollups et vues Notion non repris).`
    )
  if (summary.linksResolved || summary.linksUnresolved)
    notes.push(
      `Liens entre pages : ${summary.linksResolved} conservés, ${summary.linksUnresolved} vers du contenu absent de l’export (texte gardé).`
    )
  if (summary.imagesImported) notes.push(`${summary.imagesImported} image(s) importée(s).`)
  if (summary.imagesMissing)
    notes.push(
      `${summary.imagesMissing} image(s) non reprise(s) : absente(s) de l’export, illisible(s) ou distante(s) (gardée(s) en lien).`
    )
  if (summary.attachmentsIgnored)
    notes.push(
      `${summary.attachmentsIgnored} autre(s) fichier(s) de l’export non importé(s) (PDF, pièces jointes…).`
    )
  return (
    <div className="import-report">
      <p>
        <strong>{summary.created} page(s) créée(s).</strong>
      </p>
      <ul>
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
        {summary.warnings.map((w) => (
          <li key={w} className="warn">
            {w}
          </li>
        ))}
      </ul>
      {summary.containerId && <button onClick={onOpen}>Ouvrir les pages importées</button>}
    </div>
  )
}
