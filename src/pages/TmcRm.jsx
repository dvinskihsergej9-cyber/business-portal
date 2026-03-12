import Warehouse from "./Warehouse";

export default function TmcRm() {
  return (
    <Warehouse
      allowedSections={["tmc"]}
      pageTitle="ТМЦ и РМ"
      pageSubtitle="Заявки на склад и расходные материалы (ТМЦ)."
    />
  );
}
