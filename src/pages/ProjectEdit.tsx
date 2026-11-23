import { useNavigate, useParams } from 'react-router-dom';
import ProjectForm from '../components/Form/ProjectForm';
import { useProjectStore } from '../store/projectStore';

export default function ProjectEdit() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { addProduct, updateProduct, getProductById } = useProjectStore();

  const product = id ? getProductById(id) : null;
  const isEdit = !!id && !!product;

  const handleSubmit = (data: any) => {
    if (isEdit && product) {
      updateProduct(product.id, data);
    } else {
      addProduct(data);
    }
    navigate('/projects');
  };

  return (
    <div>
      <ProjectForm initialData={product} onSubmit={handleSubmit} />
    </div>
  );
}
