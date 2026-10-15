import { Fragment, useState, type ReactNode } from 'react'
import type { ImportSummary } from '../../../shared/types'
import { useStore } from '../store'
import { platform } from '../platform'
import {
  DOCUMENT_ACCEPT,
  importDocuments,
  type DocumentImportSummary
} from '../importers/documents'
import { t } from '../../../shared/i18n'

/** A translated text whose {name} parts are elements (emphasis…). */
function rich(text: string, parts: Record<string, ReactNode>): ReactNode[] {
  return text
    .split(/\{(\w+)\}/)
    .map((piece, i) => <Fragment key={i}>{i % 2 ? (parts[piece] ?? piece) : piece}</Fragment>)
}

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
        <h3>{t('Importer / Exporter')}</h3>
        <div className="results">
          <section className="transfer-section">
            <h4>{t('Importer depuis Notion')}</h4>
            <p>
              {rich(
                t(
                  'Dans Notion : {settings} > {exportAll}, format {format}, avec « Inclure les sous-pages » et « Créer des dossiers pour les sous-pages ».'
                ),
                {
                  settings: <em>{t('Paramètres')}</em>,
                  exportAll: <em>{t('Exporter tout le contenu de l’espace de travail')}</em>,
                  format: <strong>Markdown &amp; CSV</strong>
                }
              )}{' '}
              {web
                ? t(
                    'Choisissez ensuite le fichier .zip reçu : son contenu rejoint l’espace partagé du serveur.'
                  )
                : t(
                    'Choisissez ensuite le fichier .zip reçu (ou le dossier extrait). Tout reste sur cet ordinateur.'
                  )}
            </p>
            <button
              className="primary"
              disabled={busy || ['reader', 'guest'].includes(platform().session?.user.role ?? '')}
              onClick={() => void runImport()}
            >
              {busy ? t('Import en cours…') : t('Choisir un export Notion…')}
            </button>
            {error && <p className="error">{t('Import impossible : {error}', { error })}</p>}
            {summary && (
              <ImportReport
                summary={summary}
                onOpen={() => (open(summary.containerId), setOpen(false))}
              />
            )}
          </section>
          <section className="transfer-section">
            <h4>{t('Importer d’autres outils')}</h4>
            <p>
              {rich(
                t(
                  'Word (.docx ; Google Docs : {download}), pages web (.html), Markdown (.md), texte (.txt), Evernote (export .enex), Confluence (export HTML de l’espace, .zip) ou Google Docs en « Page Web (.zip) ». Chaque document devient une page, images comprises.'
                ),
                { download: <em>{t('Fichier > Télécharger > Microsoft Word')}</em> }
              )}
            </p>
            <button disabled={busy || !canImport} onClick={chooseDocuments}>
              {busy ? t('Import en cours…') : t('Choisir des fichiers…')}
            </button>
            {docs && (
              <div className="import-report">
                <p>
                  {t('{n} page(s) créée(s)', { n: docs.pages })}
                  {docs.images ? t(', {n} image(s)', { n: docs.images }) : ''}
                  {docs.files ? t(', {n} pièce(s) jointe(s)', { n: docs.files }) : ''}.
                  {docs.missing
                    ? t(' {n} image(s) ou pièce(s) jointe(s) non reprise(s).', { n: docs.missing })
                    : ''}
                  {docs.skipped.length
                    ? t(' Format non reconnu : {files}.', { files: docs.skipped.join(', ') })
                    : ''}
                </p>
                {docs.firstId && (
                  <button onClick={() => (open(docs.firstId), setOpen(false))}>
                    {t('Ouvrir')}
                  </button>
                )}
              </div>
            )}
          </section>
          <section className="transfer-section">
            <h4>{t('Exporter vers Markdown')}</h4>
            <p>
              {t(
                'Toutes les pages (hors corbeille) dans une archive .zip : un fichier .md par page, images comprises, un dossier par page ayant des sous-pages, liens entre pages conservés. Une seule page : menu « ⋯ » de la page dans la barre latérale.'
              )}
            </p>
            <button disabled={busy} onClick={() => void exportPage(null)}>
              {t('Exporter toutes les pages…')}
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
              {t('En HTML…')}
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
    notes.push(t('{n} page(s) déjà importées, laissées telles quelles.', { n: summary.skipped }))
  if (summary.databases)
    notes.push(
      t(
        '{n} base(s) de données importée(s), types de propriétés déduits des CSV (formules, rollups et vues Notion non repris).',
        { n: summary.databases }
      )
    )
  if (summary.linksResolved || summary.linksUnresolved)
    notes.push(
      t(
        'Liens entre pages : {kept} conservés, {lost} vers du contenu absent de l’export (texte gardé).',
        { kept: summary.linksResolved, lost: summary.linksUnresolved }
      )
    )
  if (summary.imagesImported)
    notes.push(t('{n} image(s) importée(s).', { n: summary.imagesImported }))
  if (summary.imagesMissing)
    notes.push(
      t(
        '{n} image(s) non reprise(s) : absente(s) de l’export, illisible(s) ou distante(s) (gardée(s) en lien).',
        { n: summary.imagesMissing }
      )
    )
  if (summary.attachmentsIgnored)
    notes.push(
      t('{n} autre(s) fichier(s) de l’export non importé(s) (PDF, pièces jointes…).', {
        n: summary.attachmentsIgnored
      })
    )
  return (
    <div className="import-report">
      <p>
        <strong>{t('{n} page(s) créée(s).', { n: summary.created })}</strong>
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
      {summary.containerId && <button onClick={onOpen}>{t('Ouvrir les pages importées')}</button>}
    </div>
  )
}
