import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AutenticacaoProvedor } from "./contexto/ContextoAutenticacao";
import { ConfirmacaoProvedor } from "./contexto/ContextoConfirmacao";
import { ToastProvedor } from "./contexto/ContextoToast";
import { RotaProtegida } from "./RotaProtegida";
import { LayoutAutenticado } from "./layout/LayoutAutenticado";
import { TelaCategorias } from "./paginas/TelaCategorias";
import { TelaConfiguracoes } from "./paginas/TelaConfiguracoes";
import { TelaContasECartoes } from "./paginas/TelaContasECartoes";
import { TelaDashboard } from "./paginas/TelaDashboard";
import { TelaExtrato } from "./paginas/TelaExtrato";
import { TelaAgendadas } from "./paginas/TelaAgendadas";
import { TelaRecorrentes } from "./paginas/TelaRecorrentes";
import { TelaLogin } from "./paginas/TelaLogin";
import { TelaRegras } from "./paginas/TelaRegras";
import { ProvedorDica } from "./componentes/ui/Dica";

export function App() {
  return (
    <BrowserRouter>
      <ProvedorDica>
        <AutenticacaoProvedor>
          <ToastProvedor>
            <ConfirmacaoProvedor>
              <Routes>
                <Route path="/login" element={<TelaLogin />} />
                <Route
                  element={
                    <RotaProtegida>
                      <LayoutAutenticado />
                    </RotaProtegida>
                  }
                >
                  <Route path="/" element={<TelaDashboard />} />
                  <Route path="/contas" element={<TelaContasECartoes />} />
                  <Route path="/cartoes" element={<Navigate to="/contas#cartoes" replace />} />
                  <Route path="/categorias" element={<TelaCategorias />} />
                  <Route path="/regras" element={<TelaRegras />} />
                  <Route path="/extrato" element={<TelaExtrato />} />
                  <Route path="/agendadas" element={<TelaAgendadas />} />
                  <Route path="/recorrentes" element={<TelaRecorrentes />} />
                  <Route path="/conexoes" element={<Navigate to="/contas#bancos" replace />} />
                  <Route path="/configuracoes" element={<TelaConfiguracoes />} />
                </Route>
              </Routes>
            </ConfirmacaoProvedor>
          </ToastProvedor>
        </AutenticacaoProvedor>
      </ProvedorDica>
    </BrowserRouter>
  );
}
