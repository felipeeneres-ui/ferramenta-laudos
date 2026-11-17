import { useEffect } from 'react';
import { AppHeader } from './components/AppHeader';
import { CroquiBar } from './components/CroquiBar';
import { Toolbar } from './components/Toolbar';
import { Canvas } from './components/Canvas';
import { RightPanel } from './components/RightPanel';
import { PhotosView } from './components/PhotosView';
import { ProjectsHome } from './components/ProjectsHome';
import { TableView } from './components/TableView';
import { LaudoView } from './components/LaudoView';
import { ClientView } from './components/ClientView';
import { useStore } from './store';
import { pontoVisivel, vistasDaCamada } from './types';
import { exportFloorPng } from './exportPng';
import { getBg, blobToDataUrl } from './db';

export default function App() {
  const appView = useStore((s) => s.appView);
  const home = useStore((s) => s.home);
  const deleteSelection = useStore((s) => s.deleteSelection);
  const setTool = useStore((s) => s.setTool);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (useStore.getState().home) return;
      if (useStore.getState().appView === 'fotos') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (e.key === 'Escape') {
        setTool('select');
      } else if (e.key === 'v') setTool('select');
      else if (e.key === 'w') setTool('wall');
      else if (e.key === 'p') setTool('point');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelection, setTool]);

  async function handleExport() {
    const { project } = useStore.getState();
    const floor = useStore.getState().activeFloor();
    // o PNG sai como o croqui está na tela: sem os pontos das ruas escondidas
    const pts = project.points.filter((p) => p.floorId === floor.id && pontoVisivel(project, p));
    const name = `${project.nome || 'imovel'} - ${project.croquiUnico ? 'Croqui' : floor.nome}.png`;
    let bgDataUrl: string | undefined;
    let satDataUrl: string | undefined;
    if (floor.bg) {
      const blob = await getBg(floor.id);
      if (blob) bgDataUrl = await blobToDataUrl(blob);
    }
    if (floor.sat) {
      const blob = await getBg(`${floor.id}_sat`);
      if (blob) satDataUrl = await blobToDataUrl(blob);
    }
    exportFloorPng(
      floor,
      project.anomalyTypes,
      pts,
      name,
      project.croquiPointSize ?? 18,
      bgDataUrl,
      satDataUrl,
      project.vistasNoExport ? vistasDaCamada(project, floor.id, true) : undefined,
      project.vistaSize,
    );
  }

  const croquiPane = (
    <>
      <CroquiBar onExport={handleExport} />
      <div className="body">
        <Toolbar />
        <Canvas />
        <RightPanel />
      </div>
    </>
  );

  if (home) return <ProjectsHome />;

  return (
    <div className="app">
      <AppHeader />
      {appView === 'croqui' && croquiPane}
      {appView === 'fotos' && <PhotosView />}
      {appView === 'laudo' && <LaudoView />}
      {appView === 'tabela' && <TableView />}
      {appView === 'cliente' && <ClientView />}
      {appView === 'split' && (
        <div className="split">
          <div className="split-pane">{croquiPane}</div>
          <div className="split-pane">
            <PhotosView />
          </div>
        </div>
      )}
    </div>
  );
}
